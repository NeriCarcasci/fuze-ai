from __future__ import annotations

import asyncio
import functools
import hashlib
import inspect
import json
import math
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Optional, TypeVar

from fuze_ai.config_loader import ConfigLoader
from fuze_ai.errors import FuzeError, GuardTimeout, LoopDetected, ResourceLimitExceeded
from fuze_ai.loop_detector import LoopDetector
from fuze_ai.pricing import extract_usage_from_result
from fuze_ai.resource_limit_tracker import ResourceLimitTracker
from fuze_ai.services.types import FuzeService
from fuze_ai.side_effect_registry import SideEffectRegistry
from fuze_ai.trace_recorder import TraceRecorder
from fuze_ai.types import GuardEventRecord, ResolvedOptions, StepRecord

F = TypeVar("F", bound=Callable[..., Any])


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _hash_args(args: tuple[Any, ...], kwargs: dict[str, Any]) -> str:
    def _typed_default(value: Any) -> str:
        return f"{type(value).__name__}:{value}"

    payload = json.dumps({"args": args, "kwargs": kwargs}, default=_typed_default, sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


async def _swallow(coro: Any) -> None:
    try:
        await coro
    except Exception:
        return


def _fire_and_forget(coro: Any) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        try:
            asyncio.run(_swallow(coro))
        except Exception:
            return
    else:
        loop.create_task(_swallow(coro))


def _run_service_call(coro: Any, default: Any) -> Any:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        try:
            return asyncio.run(coro)
        except Exception:
            return default

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(asyncio.run, coro)
        try:
            return future.result(timeout=0.2)
        except Exception:
            return default


def _run_with_timeout(fn: Callable[..., Any], args: tuple, kwargs: dict, timeout_ms: float) -> Any:
    if not math.isfinite(timeout_ms) or timeout_ms <= 0:
        return fn(*args, **kwargs)

    timeout_s = timeout_ms / 1000.0
    executor = ThreadPoolExecutor(max_workers=1)
    future = executor.submit(fn, *args, **kwargs)
    try:
        return future.result(timeout=timeout_s)
    except FuturesTimeoutError as exc:
        future.cancel()
        raise GuardTimeout(getattr(fn, "__name__", "unknown"), int(timeout_ms)) from exc
    finally:
        try:
            executor.shutdown(wait=False, cancel_futures=True)
        except TypeError:
            executor.shutdown(wait=False)


async def _run_async_with_timeout(
    fn: Callable[..., Any], args: tuple, kwargs: dict, timeout_ms: float
) -> Any:
    if not math.isfinite(timeout_ms) or timeout_ms <= 0:
        return await fn(*args, **kwargs)

    timeout_s = timeout_ms / 1000.0
    try:
        return await asyncio.wait_for(fn(*args, **kwargs), timeout=timeout_s)
    except asyncio.TimeoutError as exc:
        raise GuardTimeout(getattr(fn, "__name__", "unknown"), int(timeout_ms)) from exc


@dataclass
class GuardContext:
    run_id: str
    resource_limit_tracker: ResourceLimitTracker
    loop_detector: LoopDetector
    side_effect_registry: SideEffectRegistry
    trace_recorder: TraceRecorder
    service: FuzeService
    step_number: int = field(default=0)


def _record_limit_event(
    ctx: GuardContext,
    step_id: str,
    err: ResourceLimitExceeded,
) -> None:
    details = {
        "tool_name": err.tool_name,
        "limit": err.limit,
        "ceiling": err.ceiling,
        "observed": err.observed,
    }
    ctx.trace_recorder.record_guard_event(GuardEventRecord(
        event_id=str(uuid.uuid4()),
        run_id=ctx.run_id,
        step_id=step_id,
        timestamp=_now_iso(),
        type="kill",
        severity="critical",
        details=details,
    ))
    _fire_and_forget(ctx.service.send_guard_event(
        ctx.run_id,
        {
            "step_id": step_id,
            "event_type": "kill",
            "severity": "critical",
            "details": {**details, "cause": "resource_limit_exceeded"},
        },
    ))
    ctx.trace_recorder.flush()


def _make_wrapper(fn: Callable[..., Any], opts: ResolvedOptions, ctx: GuardContext) -> Callable[..., Any]:
    func_name = fn.__name__ or "anonymous"

    if opts.get("compensate"):
        ctx.side_effect_registry.register_compensation(func_name, opts["compensate"])

    def _handle_loop_signal(signal: Any, step_id: str) -> None:
        ctx.trace_recorder.record_guard_event(GuardEventRecord(
            event_id=str(uuid.uuid4()),
            run_id=ctx.run_id,
            step_id=step_id,
            timestamp=_now_iso(),
            type="loop_detected",
            severity="critical",
            details=signal["details"],
        ))
        _fire_and_forget(ctx.service.send_guard_event(
            ctx.run_id,
            {
                "step_id": step_id,
                "event_type": "loop_detected",
                "severity": "critical",
                "details": signal["details"],
            },
        ))
        if opts["on_loop"] == "kill":
            ctx.trace_recorder.flush()
            raise LoopDetected(signal, func_name)

    if inspect.iscoroutinefunction(fn):
        @functools.wraps(fn)
        async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
            step_id = str(uuid.uuid4())
            args_hash = _hash_args(args, kwargs)
            start_time = time.monotonic()
            started_at = _now_iso()
            error_msg: Optional[str] = None
            result: Any = None

            try:
                await ctx.resource_limit_tracker.check_and_reserve_step(func_name)
            except ResourceLimitExceeded as err:
                _record_limit_event(ctx, step_id, err)
                raise

            ctx.step_number += 1
            step_number = ctx.step_number

            loop_signal = ctx.loop_detector.on_step()
            if loop_signal:
                _handle_loop_signal(loop_signal, step_id)
                if opts["on_loop"] == "skip":
                    return None

            tool_signal = ctx.loop_detector.on_tool_call(f"{func_name}:{args_hash}")
            if tool_signal:
                _handle_loop_signal(tool_signal, step_id)
                if opts["on_loop"] == "skip":
                    return None

            decision = await ctx.service.send_step_start(
                ctx.run_id,
                {
                    "step_id": step_id,
                    "step_number": step_number,
                    "tool_name": func_name,
                    "args_hash": args_hash,
                    "side_effect": bool(opts.get("side_effect")),
                },
            )
            if decision == "kill":
                raise FuzeError("Transport kill: kill switch activated")

            try:
                result = await _run_async_with_timeout(fn, args, kwargs, opts["timeout"])
            except (LoopDetected, GuardTimeout):
                raise
            except Exception as exc:
                error_msg = str(exc)
                raise
            finally:
                ended_at = _now_iso()
                latency_ms = int((time.monotonic() - start_time) * 1000)
                extractor = opts.get("usage_extractor") or extract_usage_from_result
                extracted = extractor(result) if result is not None else None

                if extracted:
                    actual_tokens_in = int(extracted.get("tokens_in") or 0)
                    actual_tokens_out = int(extracted.get("tokens_out") or 0)
                else:
                    actual_tokens_in = 0
                    actual_tokens_out = 0

                ctx.trace_recorder.record_step(StepRecord(
                    step_id=step_id,
                    run_id=ctx.run_id,
                    step_number=step_number,
                    started_at=started_at,
                    ended_at=ended_at,
                    tool_name=func_name,
                    args_hash=args_hash,
                    has_side_effect=opts.get("side_effect", False),
                    tokens_in=actual_tokens_in,
                    tokens_out=actual_tokens_out,
                    latency_ms=latency_ms,
                    error=error_msg,
                ))
                ctx.resource_limit_tracker.record_usage(actual_tokens_in, actual_tokens_out)
                _fire_and_forget(ctx.service.send_step_end(
                    ctx.run_id,
                    step_id,
                    {
                        "tool_name": func_name,
                        "step_number": step_number,
                        "args_hash": args_hash,
                        "has_side_effect": bool(opts.get("side_effect")),
                        "tokens_in": actual_tokens_in,
                        "tokens_out": actual_tokens_out,
                        "latency_ms": latency_ms,
                        "error": error_msg,
                    },
                ))

            has_new_output = result is not None
            progress_signal = ctx.loop_detector.on_progress(has_new_output)
            if progress_signal:
                ctx.trace_recorder.record_guard_event(GuardEventRecord(
                    event_id=str(uuid.uuid4()),
                    run_id=ctx.run_id,
                    step_id=step_id,
                    timestamp=_now_iso(),
                    type="loop_detected",
                    severity="warning",
                    details=progress_signal["details"],
                ))
                _fire_and_forget(ctx.service.send_guard_event(
                    ctx.run_id,
                    {
                        "step_id": step_id,
                        "event_type": "loop_detected",
                        "severity": "warning",
                        "details": progress_signal["details"],
                    },
                ))
                if opts["on_loop"] == "kill":
                    ctx.trace_recorder.flush()
                    raise LoopDetected(progress_signal, func_name)

            if opts.get("side_effect"):
                ctx.side_effect_registry.record_side_effect(step_id, func_name, result)

            return result

        return async_wrapper

    @functools.wraps(fn)
    def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
        step_id = str(uuid.uuid4())
        args_hash = _hash_args(args, kwargs)
        start_time = time.monotonic()
        started_at = _now_iso()
        error_msg: Optional[str] = None
        result: Any = None

        try:
            ctx.resource_limit_tracker.check_and_reserve_step_sync(func_name)
        except ResourceLimitExceeded as err:
            _record_limit_event(ctx, step_id, err)
            raise

        ctx.step_number += 1
        step_number = ctx.step_number

        loop_signal = ctx.loop_detector.on_step()
        if loop_signal:
            _handle_loop_signal(loop_signal, step_id)
            if opts["on_loop"] == "skip":
                return None

        tool_signal = ctx.loop_detector.on_tool_call(f"{func_name}:{args_hash}")
        if tool_signal:
            _handle_loop_signal(tool_signal, step_id)
            if opts["on_loop"] == "skip":
                return None

        decision = _run_service_call(
            ctx.service.send_step_start(
                ctx.run_id,
                {
                    "step_id": step_id,
                    "step_number": step_number,
                    "tool_name": func_name,
                    "args_hash": args_hash,
                    "side_effect": bool(opts.get("side_effect")),
                },
            ),
            "proceed",
        )
        if decision == "kill":
            raise FuzeError("Transport kill: kill switch activated")

        try:
            result = _run_with_timeout(fn, args, kwargs, opts["timeout"])
        except (LoopDetected, GuardTimeout):
            raise
        except Exception as exc:
            error_msg = str(exc)
            raise
        finally:
            ended_at = _now_iso()
            latency_ms = int((time.monotonic() - start_time) * 1000)
            extractor = opts.get("usage_extractor") or extract_usage_from_result
            extracted = extractor(result) if result is not None else None

            if extracted:
                actual_tokens_in = int(extracted.get("tokens_in") or 0)
                actual_tokens_out = int(extracted.get("tokens_out") or 0)
            else:
                actual_tokens_in = 0
                actual_tokens_out = 0

            ctx.trace_recorder.record_step(StepRecord(
                step_id=step_id,
                run_id=ctx.run_id,
                step_number=step_number,
                started_at=started_at,
                ended_at=ended_at,
                tool_name=func_name,
                args_hash=args_hash,
                has_side_effect=opts.get("side_effect", False),
                tokens_in=actual_tokens_in,
                tokens_out=actual_tokens_out,
                latency_ms=latency_ms,
                error=error_msg,
            ))
            ctx.resource_limit_tracker.record_usage(actual_tokens_in, actual_tokens_out)
            _fire_and_forget(ctx.service.send_step_end(
                ctx.run_id,
                step_id,
                {
                    "tool_name": func_name,
                    "step_number": step_number,
                    "args_hash": args_hash,
                    "has_side_effect": bool(opts.get("side_effect")),
                    "tokens_in": actual_tokens_in,
                    "tokens_out": actual_tokens_out,
                    "latency_ms": latency_ms,
                    "error": error_msg,
                },
            ))

        has_new_output = result is not None
        progress_signal = ctx.loop_detector.on_progress(has_new_output)
        if progress_signal:
            ctx.trace_recorder.record_guard_event(GuardEventRecord(
                event_id=str(uuid.uuid4()),
                run_id=ctx.run_id,
                step_id=step_id,
                timestamp=_now_iso(),
                type="loop_detected",
                severity="warning",
                details=progress_signal["details"],
            ))
            _fire_and_forget(ctx.service.send_guard_event(
                ctx.run_id,
                {
                    "step_id": step_id,
                    "event_type": "loop_detected",
                    "severity": "warning",
                    "details": progress_signal["details"],
                },
            ))
            if opts["on_loop"] == "kill":
                ctx.trace_recorder.flush()
                raise LoopDetected(progress_signal, func_name)

        if opts.get("side_effect"):
            ctx.side_effect_registry.record_side_effect(step_id, func_name, result)

        return result

    return sync_wrapper


def _build_context(opts: ResolvedOptions, service: FuzeService) -> GuardContext:
    return GuardContext(
        run_id=str(uuid.uuid4()),
        resource_limit_tracker=ResourceLimitTracker(opts.get("resource_limits", {})),
        loop_detector=LoopDetector(
            max_iterations=opts["max_iterations"],
            window_size=opts["loop_detection"]["window_size"],
            repeat_threshold=opts["loop_detection"]["repeat_threshold"],
            max_flat_steps=opts["loop_detection"]["max_flat_steps"],
        ),
        side_effect_registry=SideEffectRegistry(),
        trace_recorder=TraceRecorder(opts["trace_output"]),
        service=service,
    )
