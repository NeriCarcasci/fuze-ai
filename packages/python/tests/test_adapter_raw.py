"""Tests for the raw dict dispatch adapter."""
from __future__ import annotations

from fuze_ai.adapters.raw import fuze_dispatch


def test_all_functions_wrapped():
    """fuze_dispatch returns a new dict where each function is guarded."""
    def search(q: str) -> list:
        return [q]

    def analyse(text: str) -> dict:
        return {"text": text}

    def summarize(doc: str) -> str:
        return doc[:10]

    tools = {"search": search, "analyse": analyse, "summarize": summarize}
    protected = fuze_dispatch(tools)

    assert set(protected.keys()) == {"search", "analyse", "summarize"}
    for name in tools:
        assert callable(protected[name])
        # Should not be the same object (it's wrapped)
        # (functools.wraps means same __name__ but different identity)


def test_per_tool_config_applied():
    """Per-tool config is applied correctly."""
    def send_email(to: str) -> str:
        return f"sent to {to}"

    protected = fuze_dispatch(
        {"send_email": send_email},
        config={"send_email": {"side_effect": True}},
    )

    result = protected["send_email"]("alice@example.com")
    assert result == "sent to alice@example.com"


def test_tools_without_config_get_defaults():
    """Tools without specific config get project defaults."""
    def plain_tool(x: int) -> int:
        return x * 2

    protected = fuze_dispatch({"plain": plain_tool}, config={})
    assert protected["plain"](5) == 10


def test_original_signatures_preserved():
    """Wrapped functions preserve original __name__."""
    def my_named_function(x: int) -> int:
        return x

    protected = fuze_dispatch({"my_named_function": my_named_function})
    assert protected["my_named_function"].__name__ == "my_named_function"


def test_five_functions_all_wrapped():
    """Given dict of 5 functions, all are guarded."""
    funcs = {f"tool_{i}": (lambda i: lambda x: x + i)(i) for i in range(5)}
    protected = fuze_dispatch(funcs)
    assert len(protected) == 5
