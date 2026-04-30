from __future__ import annotations

import inspect
from typing import Any, Callable, Optional

from fuze_ai.config_loader import ConfigLoader
from fuze_ai.guard import (
    GuardContext,
    _build_context,
    _fire_and_forget,
    _make_wrapper,
    current_guard_context,
)
from fuze_ai.services.noop_service import NoopService


def _start_run(options: dict[str, Any]) -> tuple[GuardContext, Any, Any]:
    from fuze_ai import _get_global_config, _get_or_create_service

    config = _get_global_config()
    resolved = ConfigLoader.merge(config, options)
    service = _get_or_create_service(resolved)
    ctx = _build_context(resolved, service)
    agent_id = "default"
    ctx.trace_recorder.start_run(ctx.run_id, agent_id, dict(resolved))
    _fire_and_forget(service.send_run_start(ctx.run_id, agent_id, dict(resolved)))
    return ctx, resolved, service


def _end_run(ctx: GuardContext, service: Any, status: str) -> None:
    ctx.trace_recorder.end_run(ctx.run_id, status)
    ctx.trace_recorder.flush()
    _fire_and_forget(service.send_run_end(ctx.run_id, status))


def _wrap_method(fn: Callable[..., Any], options: dict[str, Any]) -> Callable[..., Any]:
    bootstrap_config = ConfigLoader.merge({}, options)
    placeholder_ctx = _build_context(bootstrap_config, NoopService())
    inner = _make_wrapper(fn, bootstrap_config, placeholder_ctx)

    if inspect.iscoroutinefunction(fn):
        async def async_method_wrapper(*args: Any, **kwargs: Any) -> Any:
            if current_guard_context.get() is not None:
                return await inner(*args, **kwargs)
            ctx, _resolved, service = _start_run(options)
            token = current_guard_context.set(ctx)
            status = "completed"
            try:
                return await inner(*args, **kwargs)
            except BaseException:
                status = "error"
                raise
            finally:
                current_guard_context.reset(token)
                _end_run(ctx, service, status)

        async_method_wrapper.__name__ = fn.__name__
        async_method_wrapper.__qualname__ = getattr(fn, "__qualname__", fn.__name__)
        async_method_wrapper.__doc__ = fn.__doc__
        return async_method_wrapper

    def sync_method_wrapper(*args: Any, **kwargs: Any) -> Any:
        if current_guard_context.get() is not None:
            return inner(*args, **kwargs)
        ctx, _resolved, service = _start_run(options)
        token = current_guard_context.set(ctx)
        status = "completed"
        try:
            return inner(*args, **kwargs)
        except BaseException:
            status = "error"
            raise
        finally:
            current_guard_context.reset(token)
            _end_run(ctx, service, status)

    sync_method_wrapper.__name__ = fn.__name__
    sync_method_wrapper.__qualname__ = getattr(fn, "__qualname__", fn.__name__)
    sync_method_wrapper.__doc__ = fn.__doc__
    return sync_method_wrapper


def _apply(cls: type, options: dict[str, Any]) -> type:
    if getattr(cls, "__fuze_guarded__", False):
        return cls

    for name, value in list(vars(cls).items()):
        if name.startswith("_"):
            continue
        if not inspect.isfunction(value):
            continue
        setattr(cls, name, _wrap_method(value, options))

    cls.__fuze_guarded__ = True  # type: ignore[attr-defined]
    return cls


def guarded(_cls: Optional[type] = None, /, **options: Any) -> Any:
    def decorator(cls: type) -> type:
        return _apply(cls, options)

    if _cls is not None:
        return decorator(_cls)
    return decorator
