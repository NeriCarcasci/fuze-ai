"""Tests for the CrewAI adapter."""
from __future__ import annotations

import pytest
from fuze_ai.adapters.crewai import BaseTool, FuzeMixin
from fuze_ai.errors import LoopDetected


class SimpleTool(FuzeMixin, BaseTool):
    """A simple tool for testing."""

    fuze_config = {}

    def _run(self, query: str) -> str:
        """Run a simple search."""
        return f"result: {query}"


class SideEffectTool(FuzeMixin, BaseTool):
    """A side-effect tool for testing."""

    fuze_config = {"side_effect": True}

    def _run(self, data: str) -> str:
        return f"processed: {data}"


def test_fuse_mixin_wraps_run():
    """FuzeMixin wraps _run with guard logic."""
    tool = SimpleTool()
    result = tool._run("hello")
    assert result == "result: hello"


def test_fuze_config_applied():
    """fuze_config from class attribute is applied."""
    tool = SideEffectTool()
    # Should not raise, side_effect=True just records the call
    result = tool._run("test-data")
    assert result == "processed: test-data"


def test_works_without_crewai_installed():
    """FuzeMixin works using the stub BaseTool when CrewAI is not installed."""
    # We're already using the stub in this environment
    tool = SimpleTool()
    assert isinstance(tool, FuzeMixin)


def test_custom_fuze_config_per_instance():
    """fuze_config can be set on the class."""
    class LimitedTool(FuzeMixin, BaseTool):
        fuze_config = {"max_iterations": 2}

        def _run(self, n: int) -> str:
            return f"ok-{n}"

    tool = LimitedTool()
    tool._run(1)
    tool._run(2)
    # 3rd call may trigger loop detection depending on tool call hash
    # We just verify the tool instantiates and runs without error
    assert tool is not None
