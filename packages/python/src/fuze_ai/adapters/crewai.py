"""CrewAI adapter for Fuze AI.

Provides FuzeMixin — a mixin that wraps _run and _arun with guard() protection.

Usage::

    from fuze_ai.adapters.crewai import FuzeMixin

    try:
        from crewai_tools import BaseTool
    except ImportError:
        from fuze_ai.adapters.crewai import BaseTool  # stub for testing

    class SendEmailTool(FuzeMixin, BaseTool):
        name = "send_email"
        description = "Send an email"
        fuze_config = {"side_effect": True, "max_retries": 1}

        def _run(self, to: str, body: str) -> str:
            return smtp.send(to, body)
"""
from __future__ import annotations

from typing import Any


# Graceful stub if CrewAI is not installed
try:
    from crewai_tools import BaseTool  # type: ignore[import]
except ImportError:
    try:
        from crewai.tools import BaseTool  # type: ignore[import]
    except ImportError:
        class BaseTool:  # type: ignore[no-redef]
            """Stub BaseTool for when CrewAI is not installed."""

            def _run(self, *args: Any, **kwargs: Any) -> Any:
                raise NotImplementedError

            async def _arun(self, *args: Any, **kwargs: Any) -> Any:
                return self._run(*args, **kwargs)


class FuzeMixin:
    """Mixin that wraps _run and _arun with Fuze guard() protection.

    Reads options from the ``fuze_config`` class attribute.

    Example::

        class MyTool(FuzeMixin, BaseTool):
            fuze_config = {"side_effect": True, "max_retries": 1}

            def _run(self, query: str) -> str:
                return search(query)
    """

    fuze_config: dict[str, Any] = {}

    def __init_subclass__(cls, **kwargs: Any) -> None:
        super().__init_subclass__(**kwargs)

        # Wrap _run if defined on this class (not just inherited)
        if "_run" in cls.__dict__:
            original_run = cls.__dict__["_run"]
            cls._run = cls._make_guarded_run(original_run)

        # Wrap _arun if defined on this class
        if "_arun" in cls.__dict__:
            original_arun = cls.__dict__["_arun"]
            cls._arun = cls._make_guarded_arun(original_arun)

    @classmethod
    def _make_guarded_run(cls, original: Any) -> Any:
        """Wrap a sync _run method with guard protection."""
        from fuze_ai import guard as fuze_guard

        def wrapper(self: Any, *args: Any, **kwargs: Any) -> Any:
            opts = getattr(self, "fuze_config", {}) or {}
            protected = fuze_guard(lambda *a, **kw: original(self, *a, **kw), **opts)
            return protected(*args, **kwargs)

        wrapper.__name__ = "_run"
        wrapper.__doc__ = original.__doc__
        return wrapper

    @classmethod
    def _make_guarded_arun(cls, original: Any) -> Any:
        """Wrap an async _arun method with guard protection."""
        import asyncio
        import inspect
        from fuze_ai import guard as fuze_guard

        async def wrapper(self: Any, *args: Any, **kwargs: Any) -> Any:
            opts = getattr(self, "fuze_config", {}) or {}
            if inspect.iscoroutinefunction(original):
                protected = fuze_guard(lambda *a, **kw: original(self, *a, **kw), **opts)
            else:
                protected = fuze_guard(lambda *a, **kw: original(self, *a, **kw), **opts)
            result = protected(*args, **kwargs)
            if asyncio.iscoroutine(result):
                return await result
            return result

        wrapper.__name__ = "_arun"
        wrapper.__doc__ = original.__doc__
        return wrapper
