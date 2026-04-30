from __future__ import annotations

import asyncio
import threading
import time
from typing import Optional

from fuze_ai.errors import ResourceLimitExceeded
from fuze_ai.types import ResourceLimits, ResourceUsageStatus


class ResourceLimitTracker:
    def __init__(self, limits: Optional[ResourceLimits] = None) -> None:
        self._limits: ResourceLimits = dict(limits or {})  # type: ignore[assignment]
        self._total_tokens_in = 0
        self._total_tokens_out = 0
        self._step_count = 0
        self._started_at = time.monotonic()
        self._async_lock = asyncio.Lock()
        self._thread_lock = threading.Lock()

    async def check_and_reserve_step(self, tool_name: str) -> None:
        async with self._async_lock:
            with self._thread_lock:
                self._assert_within_limits(tool_name)
                self._step_count += 1

    def check_and_reserve_step_sync(self, tool_name: str) -> None:
        with self._thread_lock:
            self._assert_within_limits(tool_name)
            self._step_count += 1

    def record_usage(self, tokens_in: int, tokens_out: int) -> None:
        with self._thread_lock:
            if isinstance(tokens_in, (int, float)) and tokens_in >= 0:
                self._total_tokens_in += int(tokens_in)
            if isinstance(tokens_out, (int, float)) and tokens_out >= 0:
                self._total_tokens_out += int(tokens_out)

    def get_status(self) -> ResourceUsageStatus:
        with self._thread_lock:
            return {
                "total_tokens_in": self._total_tokens_in,
                "total_tokens_out": self._total_tokens_out,
                "step_count": self._step_count,
                "wall_clock_ms": int((time.monotonic() - self._started_at) * 1000),
            }

    def get_limits(self) -> ResourceLimits:
        return dict(self._limits)  # type: ignore[return-value]

    def _assert_within_limits(self, tool_name: str) -> None:
        max_steps = self._limits.get("max_steps")
        max_tokens_per_run = self._limits.get("max_tokens_per_run")
        max_wall_clock_ms = self._limits.get("max_wall_clock_ms")

        if isinstance(max_steps, int) and self._step_count + 1 > max_steps:
            raise ResourceLimitExceeded(
                tool_name=tool_name,
                limit="max_steps",
                ceiling=max_steps,
                observed=self._step_count + 1,
            )

        total_tokens = self._total_tokens_in + self._total_tokens_out
        if isinstance(max_tokens_per_run, int) and total_tokens > max_tokens_per_run:
            raise ResourceLimitExceeded(
                tool_name=tool_name,
                limit="max_tokens_per_run",
                ceiling=max_tokens_per_run,
                observed=total_tokens,
            )

        if isinstance(max_wall_clock_ms, int):
            elapsed_ms = int((time.monotonic() - self._started_at) * 1000)
            if elapsed_ms > max_wall_clock_ms:
                raise ResourceLimitExceeded(
                    tool_name=tool_name,
                    limit="max_wall_clock_ms",
                    ceiling=max_wall_clock_ms,
                    observed=elapsed_ms,
                )
