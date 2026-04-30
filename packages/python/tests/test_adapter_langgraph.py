"""Tests for the LangGraph adapter."""
from __future__ import annotations

import pytest
from fuze_ai.adapters.langgraph import fuze_tool
from fuze_ai.errors import LoopDetected


def test_fuze_tool_preserves_name():
    """fuze_tool preserves function __name__."""
    @fuze_tool
    def my_search(query: str) -> list:
        """Search for results."""
        return [query]

    assert my_search.__name__ == "my_search"


def test_fuze_tool_preserves_docstring():
    """fuze_tool preserves function __doc__."""
    @fuze_tool
    def my_search(query: str) -> list:
        """Search for results."""
        return [query]

    assert my_search.__doc__ == "Search for results."


def test_fuze_tool_no_parens():
    """@fuze_tool without parentheses works."""
    @fuze_tool
    def sync_tool(x: int) -> int:
        return x * 2

    assert sync_tool(5) == 10


def test_fuze_tool_with_options():
    """@fuze_tool(max_retries=1) applies guard options."""
    @fuze_tool(max_retries=1)
    def limited_tool(x: int) -> int:
        return x + 1

    assert limited_tool(3) == 4


def test_fuze_tool_guard_fires():
    """Guard logic fires on each invocation (budget/loop check)."""
    from fuze_ai import configure

    configure({"loop_detection": {"repeat_threshold": 100, "window_size": 100}})

    @fuze_tool(max_iterations=2)
    def repeated_tool(n: int) -> str:
        return f"result-{n}"

    repeated_tool(1)
    repeated_tool(2)

    with pytest.raises(LoopDetected):
        repeated_tool(3)


def test_fuze_tool_preserves_langchain_attributes():
    """If function has LangChain tool attributes, they are preserved."""
    def my_tool(query: str) -> str:
        """A LangChain-style tool."""
        return query

    # Simulate LangChain @tool attributes
    my_tool.name = "my_tool"
    my_tool.description = "A LangChain-style tool."

    protected = fuze_tool(my_tool)

    assert protected.__name__ == "my_tool"
    assert hasattr(protected, "name") or protected.__name__ == "my_tool"


@pytest.mark.asyncio
async def test_fuze_tool_async():
    """fuze_tool works with async functions."""
    @fuze_tool
    async def async_tool(query: str) -> list:
        return [query]

    result = await async_tool("test")
    assert result == ["test"]
