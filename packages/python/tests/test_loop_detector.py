"""Tests for LoopDetector."""
from __future__ import annotations

import pytest
from fuze_ai.loop_detector import LoopDetector


class TestLayer1IterationCap:
    def test_returns_signal_after_cap(self):
        """After max_iterations calls to on_step(), returns max_iterations signal."""
        detector = LoopDetector(max_iterations=3)

        assert detector.on_step() is None  # 1
        assert detector.on_step() is None  # 2
        assert detector.on_step() is None  # 3

        signal = detector.on_step()  # 4 > 3
        assert signal is not None
        assert signal["type"] == "max_iterations"
        assert signal["details"]["count"] == 4

    def test_no_signal_within_cap(self):
        """No signal while under the cap."""
        detector = LoopDetector(max_iterations=10)
        for _ in range(10):
            assert detector.on_step() is None


class TestLayer2RepeatedToolCall:
    def test_triggers_on_consecutive_identical(self):
        """3 consecutive identical signatures triggers repeated_tool."""
        detector = LoopDetector(repeat_threshold=3, window_size=5)

        assert detector.on_tool_call("search:abc") is None
        assert detector.on_tool_call("search:abc") is None

        signal = detector.on_tool_call("search:abc")
        assert signal is not None
        assert signal["type"] == "repeated_tool"
        assert signal["details"]["count"] == 3

    def test_no_trigger_for_abab_pattern(self):
        """Non-consecutive repeated signatures do NOT trigger."""
        detector = LoopDetector(repeat_threshold=3, window_size=5)

        # ABAB — never 3 consecutive identical
        assert detector.on_tool_call("search:abc") is None
        assert detector.on_tool_call("search:def") is None
        assert detector.on_tool_call("search:abc") is None
        assert detector.on_tool_call("search:def") is None
        assert detector.on_tool_call("search:abc") is None

    def test_different_signatures_no_trigger(self):
        """Different signatures within window do not trigger."""
        detector = LoopDetector(repeat_threshold=3, window_size=5)

        for sig in ["a", "b", "c", "d", "e"]:
            assert detector.on_tool_call(f"search:{sig}") is None

    def test_consecutive_count_respects_window(self):
        """Window trimming works correctly."""
        detector = LoopDetector(repeat_threshold=3, window_size=3)

        detector.on_tool_call("other:xyz")
        detector.on_tool_call("search:abc")
        detector.on_tool_call("search:abc")

        # Window: [other:xyz, search:abc, search:abc] → 2 consecutive, no trigger
        assert detector.on_tool_call("search:abc") is not None  # now 3 consecutive


class TestLayer3NoProgress:
    def test_triggers_after_max_flat_steps(self):
        """4 consecutive on_progress(False) triggers no_progress."""
        detector = LoopDetector(max_flat_steps=4)

        assert detector.on_progress(False) is None  # 1
        assert detector.on_progress(False) is None  # 2
        assert detector.on_progress(False) is None  # 3

        signal = detector.on_progress(False)  # 4
        assert signal is not None
        assert signal["type"] == "no_progress"
        assert signal["details"]["flat_steps"] == 4

    def test_resets_flat_count_on_new_signal(self):
        """Progress resets the flat step counter."""
        detector = LoopDetector(max_flat_steps=4)

        detector.on_progress(False)
        detector.on_progress(False)
        detector.on_progress(True)   # reset!
        detector.on_progress(False)
        detector.on_progress(False)
        detector.on_progress(False)

        signal = detector.on_progress(False)  # flat 4
        assert signal is not None
        assert signal["type"] == "no_progress"


class TestReset:
    def test_reset_clears_state(self):
        """reset() clears all internal state."""
        detector = LoopDetector(max_iterations=2)
        detector.on_step()
        detector.on_step()
        # Next would trigger — reset instead
        detector.reset()

        assert detector.on_step() is None
        assert detector.on_step() is None
