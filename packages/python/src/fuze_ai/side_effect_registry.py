"""Side-effect tracking and compensation registration for rollback."""
from __future__ import annotations

import asyncio
import inspect
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

from fuze_ai.types import CompensationResult


@dataclass
class _SideEffectEntry:
    step_id: str
    tool_name: str
    result: Any
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class SideEffectRegistry:
    """Tracks which functions have real-world consequences and manages compensation for rollback."""

    def __init__(self) -> None:
        self._compensations: dict[str, Callable[..., Any]] = {}
        self._side_effects: list[_SideEffectEntry] = []
        self._rollback_lock = asyncio.Lock()

    def register_compensation(self, tool_name: str, compensate_fn: Callable[..., Any]) -> None:
        """Register a compensation function for a tool name.

        Args:
            tool_name: The name of the tool/function.
            compensate_fn: The function to call during rollback.
        """
        self._compensations[tool_name] = compensate_fn

    def record_side_effect(self, step_id: str, tool_name: str, result: Any) -> None:
        """Record that a side-effect occurred.

        Args:
            step_id: The unique step identifier.
            tool_name: The name of the tool that produced the side-effect.
            result: The result of the tool call.
        """
        self._side_effects.append(_SideEffectEntry(
            step_id=step_id,
            tool_name=tool_name,
            result=result,
        ))

    async def rollback(self, from_step_id: str) -> list[CompensationResult]:
        """Execute rollback: call compensation functions in reverse chronological order.

        Args:
            from_step_id: The step ID to start rolling back from (inclusive).

        Returns:
            A list of CompensationResult dicts for each compensation attempted.
        """
        async with self._rollback_lock:
            start_idx = next(
                (i for i, e in enumerate(self._side_effects) if e.step_id == from_step_id),
                None,
            )

            if start_idx is None:
                to_rollback = list(reversed(self._side_effects))
            else:
                to_rollback = list(reversed(self._side_effects[start_idx:]))

            results: list[CompensationResult] = []
            for entry in to_rollback:
                compensate_fn = self._compensations.get(entry.tool_name)

                if compensate_fn is None:
                    results.append(CompensationResult(
                        step_id=entry.step_id,
                        tool_name=entry.tool_name,
                        status="no_compensation",
                        escalated=True,
                        error=None,
                    ))
                    continue

                started_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
                start_ms = time.monotonic()
                status: CompensationResult["status"] = "compensated"
                escalated = False
                error: str | None = None

                try:
                    if inspect.iscoroutinefunction(compensate_fn):
                        await compensate_fn(entry.result)
                    else:
                        maybe_awaitable = compensate_fn(entry.result)
                        if inspect.isawaitable(maybe_awaitable):
                            await maybe_awaitable
                except Exception as exc:
                    status = "failed"
                    escalated = True
                    error = str(exc)
                finally:
                    end_ms = time.monotonic()
                    results.append(CompensationResult(
                        step_id=entry.step_id,
                        tool_name=entry.tool_name,
                        status=status,
                        escalated=escalated,
                        error=error,
                        compensation_started_at=started_at,
                        compensation_ended_at=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                        compensation_latency_ms=int((end_ms - start_ms) * 1000),
                    ))

            return results

    def is_side_effect(self, tool_name: str) -> bool:
        """Check if a tool is registered as having side-effects.

        Args:
            tool_name: The name of the tool.

        Returns:
            True if the tool has a registered compensation function.
        """
        return tool_name in self._compensations

    def get_effects(self) -> list[_SideEffectEntry]:
        """Return all recorded side-effects."""
        return list(self._side_effects)
