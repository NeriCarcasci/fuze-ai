from __future__ import annotations

import asyncio
import time

import pytest
from fuze_ai.errors import ResourceLimitExceeded
from fuze_ai.resource_limit_tracker import ResourceLimitTracker


@pytest.mark.asyncio
async def test_rejects_reservation_when_step_ceiling_reached():
    tracker = ResourceLimitTracker({"max_steps": 2})

    await tracker.check_and_reserve_step("first")
    await tracker.check_and_reserve_step("second")

    with pytest.raises(ResourceLimitExceeded) as exc_info:
        await tracker.check_and_reserve_step("third")

    err = exc_info.value
    assert err.limit == "max_steps"
    assert err.ceiling == 2
    assert err.observed == 3
    assert err.tool_name == "third"


@pytest.mark.asyncio
async def test_rejects_reservation_when_token_ceiling_reached():
    tracker = ResourceLimitTracker({"max_tokens_per_run": 100})

    await tracker.check_and_reserve_step("step1")
    tracker.record_usage(80, 30)

    with pytest.raises(ResourceLimitExceeded) as exc_info:
        await tracker.check_and_reserve_step("step2")

    err = exc_info.value
    assert err.limit == "max_tokens_per_run"
    assert err.ceiling == 100
    assert err.observed == 110


@pytest.mark.asyncio
async def test_rejects_reservation_when_wall_clock_exceeded():
    tracker = ResourceLimitTracker({"max_wall_clock_ms": 50})

    await tracker.check_and_reserve_step("step1")
    await asyncio.sleep(0.1)

    with pytest.raises(ResourceLimitExceeded) as exc_info:
        await tracker.check_and_reserve_step("step2")

    err = exc_info.value
    assert err.limit == "max_wall_clock_ms"
    assert err.ceiling == 50
    assert err.observed >= 50


@pytest.mark.asyncio
async def test_concurrent_reservations_cannot_both_pass_step_ceiling():
    tracker = ResourceLimitTracker({"max_steps": 1})

    async def reserve(name: str) -> str:
        try:
            await tracker.check_and_reserve_step(name)
            return "ok"
        except ResourceLimitExceeded:
            return "rejected"

    results = await asyncio.gather(reserve("a"), reserve("b"), reserve("c"))

    assert results.count("ok") == 1
    assert results.count("rejected") == 2


@pytest.mark.asyncio
async def test_get_status_reflects_counts_and_wall_clock():
    tracker = ResourceLimitTracker()

    start = time.monotonic()
    await tracker.check_and_reserve_step("a")
    await tracker.check_and_reserve_step("b")
    tracker.record_usage(50, 25)
    tracker.record_usage(10, 5)
    await asyncio.sleep(0.02)

    status = tracker.get_status()
    assert status["step_count"] == 2
    assert status["total_tokens_in"] == 60
    assert status["total_tokens_out"] == 30
    elapsed_ms = int((time.monotonic() - start) * 1000)
    assert 15 <= status["wall_clock_ms"] <= elapsed_ms + 5


@pytest.mark.asyncio
async def test_no_limits_never_raises():
    tracker = ResourceLimitTracker()

    for i in range(100):
        await tracker.check_and_reserve_step(f"step-{i}")
        tracker.record_usage(1000, 500)

    assert tracker.get_status()["step_count"] == 100


def test_sync_reservation_respects_step_ceiling():
    tracker = ResourceLimitTracker({"max_steps": 2})

    tracker.check_and_reserve_step_sync("first")
    tracker.check_and_reserve_step_sync("second")

    with pytest.raises(ResourceLimitExceeded):
        tracker.check_and_reserve_step_sync("third")


def test_error_message_shape():
    tracker = ResourceLimitTracker({"max_steps": 0})

    with pytest.raises(ResourceLimitExceeded) as exc_info:
        tracker.check_and_reserve_step_sync("analyse")

    msg = str(exc_info.value)
    assert "analyse" in msg
    assert "max_steps" in msg
    assert "observed 1" in msg
    assert "ceiling 0" in msg
