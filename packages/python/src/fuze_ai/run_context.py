from __future__ import annotations

import contextvars
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Iterator, Optional

from fuze_ai.services.types import FuzeService
from fuze_ai.trace_recorder import TraceRecorder
from fuze_ai.types import FuzeConfig


@dataclass
class ActiveRunContext:
    run_id: str
    trace_recorder: TraceRecorder
    service: FuzeService
    config: FuzeConfig = field(default_factory=dict)
    session_id: Optional[str] = None
    user_id: Optional[str] = None
    tenant: Optional[str] = None
    parent_step_id: Optional[str] = None
    step_number: int = 0


_current_run_context: contextvars.ContextVar[Optional[ActiveRunContext]] = contextvars.ContextVar(
    "fuze_current_run_context", default=None
)


def get_current_run_context() -> Optional[ActiveRunContext]:
    return _current_run_context.get()


@contextmanager
def run_with_context(ctx: ActiveRunContext) -> Iterator[ActiveRunContext]:
    token = _current_run_context.set(ctx)
    try:
        yield ctx
    finally:
        _current_run_context.reset(token)


@contextmanager
def child_parent_step(step_id: str) -> Iterator[None]:
    ctx = _current_run_context.get()
    if ctx is None:
        yield
        return
    previous = ctx.parent_step_id
    ctx.parent_step_id = step_id
    try:
        yield
    finally:
        ctx.parent_step_id = previous
