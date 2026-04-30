"""Tests for SideEffectRegistry."""
from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

import pytest
from fuze_ai.side_effect_registry import SideEffectRegistry


@pytest.mark.asyncio
async def test_rollback_calls_compensation_with_result():
    """record then rollback must call compensation with original result."""
    registry = SideEffectRegistry()
    compensate = MagicMock()

    registry.register_compensation("send_email", compensate)
    registry.record_side_effect("step-1", "send_email", {"message_id": "msg-123"})

    results = await registry.rollback("step-1")

    assert len(results) == 1
    assert results[0]["status"] == "compensated"
    assert results[0]["escalated"] is False
    compensate.assert_called_once_with({"message_id": "msg-123"})


@pytest.mark.asyncio
async def test_rollback_reverse_chronological_order():
    """Multiple side-effects rolled back in reverse chronological order."""
    registry = SideEffectRegistry()
    call_order: list[str] = []

    registry.register_compensation("invoice", lambda _: call_order.append("invoice"))
    registry.register_compensation("email", lambda _: call_order.append("email"))

    registry.record_side_effect("step-1", "invoice", {"id": "inv-1"})
    registry.record_side_effect("step-2", "email", {"id": "msg-1"})

    await registry.rollback("step-1")

    assert call_order == ["email", "invoice"]


@pytest.mark.asyncio
async def test_rollback_no_compensation_returns_escalated():
    """No compensation registered → returns no_compensation with escalated=True."""
    registry = SideEffectRegistry()
    registry.record_side_effect("step-1", "delete_file", {"path": "/tmp/foo"})

    results = await registry.rollback("step-1")

    assert len(results) == 1
    assert results[0]["status"] == "no_compensation"
    assert results[0]["escalated"] is True
    assert results[0]["tool_name"] == "delete_file"


def test_is_side_effect_false_for_unregistered():
    """is_side_effect returns False for unregistered tools."""
    registry = SideEffectRegistry()

    assert registry.is_side_effect("search") is False
    assert registry.is_side_effect("analyse") is False


def test_is_side_effect_true_for_registered():
    """is_side_effect returns True after registration."""
    registry = SideEffectRegistry()
    registry.register_compensation("send_email", lambda _: None)

    assert registry.is_side_effect("send_email") is True


@pytest.mark.asyncio
async def test_rollback_handles_compensation_failure():
    """Compensation function failure → returns failed result with escalated=True."""
    registry = SideEffectRegistry()

    def failing_comp(_):
        raise RuntimeError("compensation failed")

    registry.register_compensation("risky", failing_comp)
    registry.record_side_effect("step-1", "risky", {"data": "x"})

    results = await registry.rollback("step-1")

    assert results[0]["status"] == "failed"
    assert results[0]["escalated"] is True
    assert "compensation failed" in results[0]["error"]


@pytest.mark.asyncio
async def test_compensation_end_timestamp_is_recorded_after_completion():
    registry = SideEffectRegistry()

    async def slow_comp(_):
        await asyncio.sleep(0.2)

    registry.register_compensation("slow_comp", slow_comp)
    registry.record_side_effect("step-1", "slow_comp", {"id": "x"})

    results = await registry.rollback("step-1")
    result = results[0]

    assert result["compensation_started_at"]
    assert result["compensation_ended_at"]
    assert result["compensation_latency_ms"] >= 200


@pytest.mark.asyncio
async def test_compensation_end_timestamp_is_captured_when_compensation_fails():
    registry = SideEffectRegistry()

    async def failing_comp(_):
        await asyncio.sleep(0.1)
        raise RuntimeError("rollback exploded")

    registry.register_compensation("failing", failing_comp)
    registry.record_side_effect("step-1", "failing", {"id": "x"})

    results = await registry.rollback("step-1")
    result = results[0]

    assert result["status"] == "failed"
    assert result["error"] == "rollback exploded"
    assert result["compensation_started_at"]
    assert result["compensation_ended_at"]
    assert result["compensation_latency_ms"] >= 100
