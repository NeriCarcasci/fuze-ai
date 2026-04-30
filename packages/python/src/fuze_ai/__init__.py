from __future__ import annotations

import asyncio
from typing import Any, Callable, Optional, TypeVar

from fuze_ai.config_loader import ConfigLoader
from fuze_ai.errors import (
    FuzeError,
    GuardTimeout,
    LoopDetected,
    ResourceLimitExceeded,
)
from fuze_ai.guard import GuardContext, _build_context, _make_wrapper
from fuze_ai.guarded import guarded
from fuze_ai.pricing import extract_usage_from_result
from fuze_ai.resource_limit_tracker import ResourceLimitTracker
from fuze_ai.services import create_service
from fuze_ai.services.types import FuzeService, ToolRegistration
from fuze_ai.trace_recorder import verify_chain
from fuze_ai.types import (
    FuzeConfig,
    GuardOptions,
    ResourceLimits,
    ResourceUsageStatus,
)

__all__ = [
    "guard",
    "guarded",
    "configure",
    "create_run",
    "register_tools",
    "reset_config",
    "GuardOptions",
    "FuzeConfig",
    "ResourceLimits",
    "ResourceUsageStatus",
    "ResourceLimitTracker",
    "ResourceLimitExceeded",
    "LoopDetected",
    "GuardTimeout",
    "FuzeError",
    "extract_usage_from_result",
    "verify_chain",
]

F = TypeVar("F", bound=Callable[..., Any])

_global_config: FuzeConfig = {}
_config_loaded = False
_service: FuzeService | None = None


def _merge_optional_dict(base: dict[str, Any] | None, override: dict[str, Any] | None) -> dict[str, Any] | None:
    if base is None and override is None:
        return None
    return {**(base or {}), **(override or {})}


def _merge_configs(base: FuzeConfig, override: FuzeConfig) -> FuzeConfig:
    merged: FuzeConfig = {**base, **override}
    defaults = _merge_optional_dict(base.get("defaults"), override.get("defaults"))
    loop_detection = _merge_optional_dict(base.get("loop_detection"), override.get("loop_detection"))

    if defaults is not None:
        merged["defaults"] = defaults  # type: ignore[assignment]
    if loop_detection is not None:
        merged["loop_detection"] = loop_detection  # type: ignore[assignment]
    cloud = _merge_optional_dict(base.get("cloud"), override.get("cloud"))  # type: ignore[arg-type]
    if cloud is not None:
        merged["cloud"] = cloud  # type: ignore[assignment]
    daemon = _merge_optional_dict(base.get("daemon"), override.get("daemon"))  # type: ignore[arg-type]
    if daemon is not None:
        merged["daemon"] = daemon  # type: ignore[assignment]
    resource_limits = _merge_optional_dict(
        base.get("resource_limits"), override.get("resource_limits"),  # type: ignore[arg-type]
    )
    if resource_limits is not None:
        merged["resource_limits"] = resource_limits  # type: ignore[assignment]
    return merged


async def _swallow(coro: Any) -> None:
    try:
        await coro
    except Exception:
        return


def _run_async_safely(coro: Any) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        try:
            asyncio.run(_swallow(coro))
        except Exception:
            return
    else:
        loop.create_task(_swallow(coro))


def _get_or_create_service(config: FuzeConfig) -> FuzeService:
    global _service
    if _service is None:
        _service = create_service(config)
        _run_async_safely(_service.connect())
    return _service


def _get_global_config() -> FuzeConfig:
    global _global_config, _config_loaded
    if not _config_loaded:
        try:
            file_config = ConfigLoader.load()
            _global_config = _merge_configs(file_config, _global_config)
        except Exception:
            pass
        _config_loaded = True
    return _global_config


def configure(config: FuzeConfig) -> None:
    global _global_config, _config_loaded, _service
    _global_config = _merge_configs(_global_config, config)
    _config_loaded = False

    if _service is not None:
        _run_async_safely(_service.disconnect())
        _service = None


def reset_config() -> None:
    global _global_config, _config_loaded, _service
    _global_config = {}
    _config_loaded = False
    if _service is not None:
        _run_async_safely(_service.disconnect())
        _service = None


def guard(_fn: Optional[Callable[..., Any]] = None, /, **options: Any) -> Any:
    def decorator(fn: Callable[..., Any]) -> Callable[..., Any]:
        config = _get_global_config()
        resolved = ConfigLoader.merge(config, options)
        service = _get_or_create_service(resolved)
        ctx = _build_context(resolved, service)
        return _make_wrapper(fn, resolved, ctx)

    if _fn is not None:
        return decorator(_fn)
    return decorator


class RunContext:
    def __init__(self, ctx: GuardContext, resolved_opts: Any) -> None:
        self._ctx = ctx
        self._resolved_opts = resolved_opts

    def guard(self, _fn: Optional[Callable[..., Any]] = None, /, **options: Any) -> Any:
        def decorator(fn: Callable[..., Any]) -> Callable[..., Any]:
            step_opts = ConfigLoader.merge(_get_global_config(), {**dict(self._resolved_opts), **options})
            return _make_wrapper(fn, step_opts, self._ctx)

        if _fn is not None:
            return decorator(_fn)
        return decorator

    def get_status(self) -> ResourceUsageStatus:
        return self._ctx.resource_limit_tracker.get_status()

    def end(self, status: str = "completed") -> None:
        self._ctx.trace_recorder.end_run(self._ctx.run_id, status)
        self._ctx.trace_recorder.flush()
        _run_async_safely(self._ctx.service.send_run_end(self._ctx.run_id, status))

    @property
    def run_id(self) -> str:
        return self._ctx.run_id


def create_run(config: Optional[dict[str, Any]] = None) -> RunContext:
    config = config or {}
    agent_id = config.pop("agent_id", "default") if isinstance(config, dict) else "default"

    global_config = _get_global_config()
    resolved = ConfigLoader.merge(global_config, config)
    service = _get_or_create_service(resolved)
    ctx = _build_context(resolved, service)

    ctx.trace_recorder.start_run(ctx.run_id, agent_id, dict(resolved))
    _run_async_safely(service.send_run_start(ctx.run_id, agent_id, dict(resolved)))

    return RunContext(ctx, resolved)


def register_tools(project_id: str, tools: list[ToolRegistration]) -> None:
    config = _get_global_config()
    service = _get_or_create_service(config)
    _run_async_safely(service.register_tools(project_id, tools))
