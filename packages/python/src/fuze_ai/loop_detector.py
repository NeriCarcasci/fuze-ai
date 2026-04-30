"""3-layer loop detection: iteration cap, repeated tool calls, no-progress detection."""
from __future__ import annotations

from collections import deque
from typing import Optional

from fuze_ai.types import LoopSignal


class LoopDetector:
    """Detects agent loops using three layers of analysis.

    Layer 1: Hard iteration cap (on_step).
    Layer 2: Sliding window hash dedup for repeated tool calls (on_tool_call).
    Layer 3: No-progress detection — consecutive steps with no novel output (on_progress).

    Args:
        max_iterations: Hard cap on total step count. Default: 25.
        window_size: Size of the sliding window for Layer 2. Default: 5.
        repeat_threshold: Consecutive identical calls to trigger Layer 2. Default: 3.
        max_flat_steps: Consecutive no-progress steps to trigger Layer 3. Default: 4.
    """

    def __init__(
        self,
        max_iterations: int = 25,
        window_size: int = 5,
        repeat_threshold: int = 3,
        max_flat_steps: int = 4,
    ) -> None:
        self._max_iterations = max_iterations
        self._window_size = window_size
        self._repeat_threshold = repeat_threshold
        self._max_flat_steps = max_flat_steps

        self._iteration_count = 0
        self._tool_call_window: deque[str] = deque(maxlen=window_size)
        self._flat_step_count = 0

    def on_step(self) -> Optional[LoopSignal]:
        """Called every step. Checks Layer 1 (iteration cap).

        Returns:
            A LoopSignal if the iteration cap is reached, or None.
        """
        self._iteration_count += 1
        if self._iteration_count > self._max_iterations:
            return LoopSignal(
                type="max_iterations",
                details={
                    "count": self._iteration_count,
                    "max": self._max_iterations,
                },
            )
        return None

    def on_tool_call(self, signature: str) -> Optional[LoopSignal]:
        """Called every tool call with a signature hash. Checks Layer 2 (sliding window dedup).

        Args:
            signature: Hash string identifying the tool call (e.g. 'func_name:args_hash').

        Returns:
            A LoopSignal if repeated calls are detected, or None.
        """
        self._tool_call_window.append(signature)

        # Count consecutive identical signatures at the tail of the window
        consecutive = 0
        for sig in reversed(self._tool_call_window):
            if sig == signature:
                consecutive += 1
            else:
                break

        if consecutive >= self._repeat_threshold:
            return LoopSignal(
                type="repeated_tool",
                details={
                    "signature": signature,
                    "count": consecutive,
                    "window_size": self._window_size,
                },
            )
        return None

    def on_progress(self, has_new_signal: bool) -> Optional[LoopSignal]:
        """Called after result analysis. Checks Layer 3 (no-progress detection).

        Args:
            has_new_signal: Whether the step produced novel output.

        Returns:
            A LoopSignal if too many steps without progress, or None.
        """
        if has_new_signal:
            self._flat_step_count = 0
            return None

        self._flat_step_count += 1
        if self._flat_step_count >= self._max_flat_steps:
            return LoopSignal(
                type="no_progress",
                details={
                    "flat_steps": self._flat_step_count,
                    "max_flat_steps": self._max_flat_steps,
                },
            )
        return None

    def reset(self) -> None:
        """Reset all internal state."""
        self._iteration_count = 0
        self._tool_call_window.clear()
        self._flat_step_count = 0
