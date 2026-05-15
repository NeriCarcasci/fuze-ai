from __future__ import annotations

import functools
import hashlib
import inspect
import json
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from fuze_ai.errors import FuzeError
from fuze_ai.run_context import ActiveRunContext, child_parent_step, get_current_run_context
from fuze_ai.types import CaptureMode, SpanRole, StepContent, StepRecord


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _hash_payload(payload: Any) -> str:
    def _typed_default(value: Any) -> str:
        return f"{type(value).__name__}:{value}"

    serialized = json.dumps(
        payload,
        default=_typed_default,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(serialized.encode()).hexdigest()[:16]


def _hash_args(args: tuple[Any, ...], kwargs: dict[str, Any]) -> str:
    return _hash_payload({"args": list(args), "kwargs": kwargs})


def _hash_for_span(
    content: Optional[StepContent],
    tool_name: str,
    role: SpanRole,
) -> str:
    if content is not None:
        return _hash_payload(content)
    return _hash_payload({"tool_name": tool_name, "role": role})


def _resolve_content(
    capture: CaptureMode,
    content: Optional[StepContent],
    ctx: ActiveRunContext,
) -> Optional[StepContent]:
    if capture == "hash":
        return None
    if content is None:
        return None
    if capture == "full":
        return content
    if capture == "full+redact":
        redactor = (ctx.config or {}).get("redactor")
        if redactor is None:
            raise FuzeError("full+redact requires a configured redactor")
        return redactor.redact_content(content)
    return content


def _build_record(
    *,
    ctx: ActiveRunContext,
    role: SpanRole,
    capture: CaptureMode,
    content: Optional[StepContent],
    attrs: Optional[dict[str, Any]],
    tool_name: str,
    args_hash: str,
    started_at: str,
    ended_at: str,
    latency_ms: int,
    tokens_in: int,
    tokens_out: int,
    error: Optional[str],
    step_id: str,
) -> StepRecord:
    record: dict[str, Any] = {
        "step_id": step_id,
        "run_id": ctx.run_id,
        "step_number": ctx.step_number,
        "started_at": started_at,
        "ended_at": ended_at,
        "tool_name": tool_name,
        "args_hash": args_hash,
        "has_side_effect": False,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "latency_ms": latency_ms,
        "error": error,
        "role": role,
        "capture": capture,
    }
    if ctx.parent_step_id is not None:
        record["parent_step_id"] = ctx.parent_step_id
    if content is not None:
        record["content"] = content
    if attrs is not None:
        record["attrs"] = attrs
    return record  # type: ignore[return-value]


async def span(
    *,
    role: SpanRole,
    capture: CaptureMode = "hash",
    content: Optional[StepContent] = None,
    attrs: Optional[dict[str, Any]] = None,
    tool_name: Optional[str] = None,
) -> None:
    ctx = get_current_run_context()
    if ctx is None:
        raise FuzeError("span() called outside fuze.run()")

    resolved_tool = tool_name or role
    resolved_content = _resolve_content(capture, content, ctx)
    args_hash = _hash_for_span(resolved_content if capture != "hash" else content, resolved_tool, role)

    ctx.step_number += 1
    now = _now_iso()
    step_id = str(uuid.uuid4())

    record = _build_record(
        ctx=ctx,
        role=role,
        capture=capture,
        content=resolved_content,
        attrs=attrs,
        tool_name=resolved_tool,
        args_hash=args_hash,
        started_at=now,
        ended_at=now,
        latency_ms=0,
        tokens_in=0,
        tokens_out=0,
        error=None,
        step_id=step_id,
    )
    ctx.trace_recorder.record_step(record)


def traced(
    fn: Callable[..., Any],
    *,
    role: SpanRole,
    capture: CaptureMode = "hash",
    tool_name: Optional[str] = None,
    capture_args: Optional[Callable[..., Any]] = None,
    capture_result: Optional[Callable[[Any], Any]] = None,
) -> Callable[..., Any]:
    resolved_tool = tool_name or fn.__name__ or "anonymous"

    def _record_call(
        ctx: ActiveRunContext,
        args: tuple[Any, ...],
        kwargs: dict[str, Any],
        result: Any,
        started_at: str,
        start_time: float,
        error_msg: Optional[str],
        step_id: str,
    ) -> None:
        ended_at = _now_iso()
        latency_ms = int((time.monotonic() - start_time) * 1000)

        raw_content: Optional[StepContent] = None
        if capture != "hash":
            captured_args: Any = capture_args(*args, **kwargs) if capture_args else {"args": list(args), "kwargs": kwargs}
            tc: dict[str, Any] = {"kind": "tool_call", "args": captured_args}
            if error_msg is None and result is not None:
                tc["result"] = capture_result(result) if capture_result else result
            raw_content = tc  # type: ignore[assignment]

        resolved_content = _resolve_content(capture, raw_content, ctx)
        args_hash = _hash_args(args, kwargs)

        record = _build_record(
            ctx=ctx,
            role=role,
            capture=capture,
            content=resolved_content,
            attrs=None,
            tool_name=resolved_tool,
            args_hash=args_hash,
            started_at=started_at,
            ended_at=ended_at,
            latency_ms=latency_ms,
            tokens_in=0,
            tokens_out=0,
            error=error_msg,
            step_id=step_id,
        )
        ctx.trace_recorder.record_step(record)

    if inspect.iscoroutinefunction(fn):
        @functools.wraps(fn)
        async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
            ctx = get_current_run_context()
            if ctx is None:
                raise FuzeError("traced() called outside fuze.run()")

            ctx.step_number += 1
            step_id = str(uuid.uuid4())
            started_at = _now_iso()
            start_time = time.monotonic()
            error_msg: Optional[str] = None
            result: Any = None
            try:
                with child_parent_step(step_id):
                    result = await fn(*args, **kwargs)
                return result
            except Exception as exc:
                error_msg = str(exc)
                raise
            finally:
                _record_call(ctx, args, kwargs, result, started_at, start_time, error_msg, step_id)

        return async_wrapper

    @functools.wraps(fn)
    def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
        ctx = get_current_run_context()
        if ctx is None:
            raise FuzeError("traced() called outside fuze.run()")

        ctx.step_number += 1
        step_id = str(uuid.uuid4())
        started_at = _now_iso()
        start_time = time.monotonic()
        error_msg: Optional[str] = None
        result: Any = None
        try:
            with child_parent_step(step_id):
                result = fn(*args, **kwargs)
            return result
        except Exception as exc:
            error_msg = str(exc)
            raise
        finally:
            _record_call(ctx, args, kwargs, result, started_at, start_time, error_msg, step_id)

    return sync_wrapper
