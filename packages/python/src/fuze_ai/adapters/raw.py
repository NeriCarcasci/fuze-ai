"""Raw dict-of-functions dispatch adapter for Fuze AI.

Usage::

    from fuze_ai.adapters.raw import fuze_dispatch

    tools = {
        "search": search_documents,
        "send_email": send_invoice,
    }

    protected = fuze_dispatch(tools, config={
        "send_email": {"side_effect": True, "max_retries": 1},
    })

    # Use like normal — same interface, guarded:
    protected["search"]("my query")
    protected["send_email"]("alice@example.com", 99.0)
"""
from __future__ import annotations

from typing import Any, Callable

from fuze_ai import guard as fuze_guard


def fuze_dispatch(
    tools: dict[str, Callable[..., Any]],
    config: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Callable[..., Any]]:
    """Wrap a dict of functions with Fuze guard() protection.

    Args:
        tools: Dict mapping tool names to callables.
        config: Optional per-tool guard options keyed by tool name.
                Tools without specific config get project defaults.

    Returns:
        A new dict with the same keys, each function replaced with its
        guarded equivalent.

    Example::

        protected = fuze_dispatch(
            {"search": search_fn, "email": email_fn},
            config={"email": {"side_effect": True}},
        )
    """
    config = config or {}
    protected: dict[str, Callable[..., Any]] = {}

    for name, fn in tools.items():
        opts = config.get(name, {})
        protected[name] = fuze_guard(fn, **opts)

    return protected
