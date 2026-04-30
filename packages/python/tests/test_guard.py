"""Tests for the @guard decorator."""
from __future__ import annotations

import asyncio
import time

import pytest
from fuze_ai import configure, guard, reset_config
from fuze_ai.errors import GuardTimeout, LoopDetected, ResourceLimitExceeded
from fuze_ai.guard import _hash_args


def test_guard_no_parens_sync():
    """@guard without parentheses wraps a sync function."""
    @guard
    def add(a, b):
        return a + b

    assert add(2, 3) == 5


def test_guard_with_parens_empty():
    """@guard() with no options works."""
    @guard()
    def mul(a, b):
        return a * b

    assert mul(3, 4) == 12


def test_guard_with_options():
    """@guard(max_retries=1) applies options."""
    @guard(max_retries=1)
    def sub(a, b):
        return a - b

    assert sub(10, 4) == 6


def test_guard_preserves_function_name():
    """Wrapped function preserves __name__."""
    @guard
    def my_special_function():
        return 1

    assert my_special_function.__name__ == "my_special_function"


def test_guard_preserves_docstring():
    """Wrapped function preserves __doc__."""
    @guard
    def documented():
        """This is a docstring."""
        return 1

    assert documented.__doc__ == "This is a docstring."


@pytest.mark.asyncio
async def test_guard_async_function():
    """@guard wraps an async function correctly."""
    @guard
    async def async_search(query):
        return {"results": [query]}

    result = await async_search("test")
    assert result == {"results": ["test"]}


def test_guard_timeout_raises():
    """Guarded function that exceeds timeout raises GuardTimeout."""
    @guard(timeout=50)
    def slow():
        time.sleep(1)

    with pytest.raises(GuardTimeout) as exc_info:
        slow()

    assert "slow" in str(exc_info.value)
    assert "50ms" in str(exc_info.value)


def test_guard_sync_timeout_does_not_block_until_function_finishes():
    """Timeout should return promptly instead of waiting for the full function duration."""
    @guard(timeout=50)
    def very_slow():
        time.sleep(1.0)

    started = time.perf_counter()
    with pytest.raises(GuardTimeout):
        very_slow()
    elapsed = time.perf_counter() - started

    assert elapsed < 0.5


@pytest.mark.asyncio
async def test_guard_async_timeout_raises():
    """Async guarded function that exceeds timeout raises GuardTimeout."""
    @guard(timeout=50)
    async def slow_async():
        await asyncio.sleep(1)

    with pytest.raises(GuardTimeout):
        await slow_async()


def test_guard_resource_limit_exceeded_raises():
    @guard(resource_limits={"max_steps": 2})
    def step(n):
        return n

    step(1)
    step(2)
    with pytest.raises(ResourceLimitExceeded):
        step(3)


def test_guard_loop_detected_after_iterations():
    """Guard raises LoopDetected after maxIterations calls."""
    configure({"loop_detection": {"repeat_threshold": 100, "window_size": 100}})

    @guard(max_iterations=3)
    def step(n):
        return f"result-{n}"

    step(1)
    step(2)
    step(3)

    with pytest.raises(LoopDetected):
        step(4)


def test_hash_args_serializer_includes_type_name_for_non_json_values():
    class Alpha:
        def __str__(self) -> str:
            return "same-payload"

    class Beta:
        def __str__(self) -> str:
            return "same-payload"

    alpha_hash = _hash_args((Alpha(),), {})
    beta_hash = _hash_args((Beta(),), {})
    assert alpha_hash != beta_hash
