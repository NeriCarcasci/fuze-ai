from __future__ import annotations

from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from fuze_ai.types import LoopSignal


ResourceLimitKind = Literal["max_steps", "max_tokens_per_run", "max_wall_clock_ms"]


class FuzeError(Exception):
    pass


class ResourceLimitExceeded(FuzeError):
    def __init__(
        self,
        tool_name: str,
        limit: ResourceLimitKind,
        ceiling: int,
        observed: int,
    ) -> None:
        super().__init__(
            f"ResourceLimitExceeded: step '{tool_name}' exceeded {limit} "
            f"(observed {observed}, ceiling {ceiling})"
        )
        self.tool_name = tool_name
        self.limit: ResourceLimitKind = limit
        self.ceiling = ceiling
        self.observed = observed


class LoopDetected(FuzeError):
    def __init__(self, signal: "LoopSignal", tool_name: str | None = None) -> None:
        prefix = f"step '{tool_name}'" if tool_name else "run"
        messages = {
            "max_iterations": (
                f"LoopDetected: {prefix} hit iteration cap "
                f"({signal['details'].get('count', '?')} iterations)"
            ),
            "repeated_tool": (
                f"LoopDetected: {prefix} repeated identical call "
                f"{signal['details'].get('count', '?')} times "
                f"in window of {signal['details'].get('window_size', '?')}"
            ),
            "no_progress": (
                f"LoopDetected: {prefix} made "
                f"{signal['details'].get('flat_steps', '?')} consecutive steps "
                f"with no new output"
            ),
        }
        super().__init__(messages.get(signal["type"], f"LoopDetected: {signal['type']}"))
        self.signal = signal


class GuardTimeout(FuzeError):
    def __init__(self, tool_name: str, timeout_ms: int) -> None:
        super().__init__(
            f"GuardTimeout: step '{tool_name}' exceeded timeout of {timeout_ms}ms"
        )
        self.tool_name = tool_name
        self.timeout_ms = timeout_ms
