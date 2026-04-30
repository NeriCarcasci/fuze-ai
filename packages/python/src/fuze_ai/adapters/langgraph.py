"""LangGraph adapter for Fuze AI.

Provides fuze_tool() — a decorator that wraps a function with guard() protection
while preserving LangGraph/LangChain tool metadata.

Usage::

    from fuze_ai.adapters.langgraph import fuze_tool

    @fuze_tool(side_effect=True, max_retries=1)
    def send_email(to: str, body: str) -> str:
        \"\"\"Send an email to a recipient.\"\"\"
        return smtp.send(to, body)

    # Use with ToolNode as normal:
    from langgraph.prebuilt import ToolNode
    tool_node = ToolNode([send_email])
"""
from __future__ import annotations

import functools
from typing import Any, Callable

from fuze_ai import guard as fuze_guard


def fuze_tool(_fn: Callable[..., Any] | None = None, /, **options: Any) -> Any:
    """Decorator that wraps a function with Fuze protection and preserves tool metadata.

    Works with both plain functions and LangChain @tool decorated functions.
    Preserves __name__, __doc__, __annotations__, and any LangChain tool attributes.

    Args:
        _fn: The function to wrap (when used as @fuze_tool without parentheses).
        **options: Guard options (side_effect, resource_limits, max_retries, etc.).

    Returns:
        The wrapped function with Fuze protection and preserved metadata.

    Example::

        @fuze_tool(side_effect=True, max_retries=1)
        def send_email(to: str, body: str) -> str:
            \"\"\"Send an email.\"\"\"
            return smtp.send(to, body)
    """
    def decorator(fn: Callable[..., Any]) -> Callable[..., Any]:
        # Apply guard protection
        protected = fuze_guard(fn, **options)

        # Preserve all metadata from the original function
        functools.update_wrapper(protected, fn)

        # Preserve LangChain @tool attributes if present
        for attr in ("name", "description", "args_schema", "return_direct",
                     "handle_tool_error", "handle_validation_error"):
            if hasattr(fn, attr) and not hasattr(protected, attr):
                try:
                    setattr(protected, attr, getattr(fn, attr))
                except (AttributeError, TypeError):
                    pass

        return protected

    if _fn is not None:
        return decorator(_fn)
    return decorator
