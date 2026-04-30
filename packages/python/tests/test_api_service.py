from __future__ import annotations

import asyncio
import json

import httpx
import pytest

import fuze_ai.services.api_service as api_service_module
from fuze_ai.services.api_service import ApiService
from fuze_ai.services.types import StepCheckData, StepEndData

STEP_CHECK: StepCheckData = {
    "step_id": "step-1",
    "step_number": 1,
    "tool_name": "search",
    "args_hash": "abc123",
    "side_effect": False,
}

STEP_END: StepEndData = {
    "tool_name": "search",
    "step_number": 1,
    "args_hash": "abc123",
    "has_side_effect": False,
    "tokens_in": 100,
    "tokens_out": 50,
    "latency_ms": 20,
    "error": None,
}


def _decode_json_request(request: httpx.Request) -> dict[str, object]:
    if not request.content:
        return {}
    return json.loads(request.content.decode("utf-8"))


@pytest.mark.asyncio
async def test_batches_ten_events_into_single_post_after_flush_interval() -> None:
    event_payloads: list[dict[str, object]] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/health":
            return httpx.Response(200, json={})
        if request.url.path == "/v1/tools/config":
            return httpx.Response(200, json={"tools": {}})
        if request.url.path == "/v1/events":
            event_payloads.append(_decode_json_request(request))
            return httpx.Response(200, json={})
        return httpx.Response(200, json={})

    transport = httpx.MockTransport(handler)
    client = httpx.AsyncClient(transport=transport)
    service = ApiService(
        "test-key",
        endpoint="https://example.test",
        flush_interval_ms=1000,
        client=client,
    )

    assert await service.connect() is True

    for idx in range(10):
        await service.send_step_end("run-1", f"step-{idx}", STEP_END)

    await asyncio.sleep(1.05)
    for _ in range(20):
        if event_payloads:
            break
        await asyncio.sleep(0.01)

    assert len(event_payloads) == 1
    payload = event_payloads[0]
    assert "events" in payload
    assert isinstance(payload["events"], list)
    assert len(payload["events"]) == 10

    await service.disconnect()


@pytest.mark.asyncio
async def test_circuit_breaker_opens_after_three_failures_and_skips_fourth() -> None:
    step_check_attempts = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal step_check_attempts
        if request.url.path == "/v1/step/check":
            step_check_attempts += 1
            return httpx.Response(500, json={"error": "down"})
        return httpx.Response(500, json={"error": "down"})

    transport = httpx.MockTransport(handler)
    client = httpx.AsyncClient(transport=transport)
    service = ApiService("test-key", endpoint="https://example.test", client=client)

    await service.send_step_start("run-1", STEP_CHECK)
    await service.send_step_start("run-1", STEP_CHECK)
    await service.send_step_start("run-1", STEP_CHECK)
    await service.send_step_start("run-1", STEP_CHECK)

    assert step_check_attempts == 3
    assert service.is_connected() is False

    await service.disconnect()


@pytest.mark.asyncio
async def test_circuit_breaker_recovers_after_cooldown_with_probe_success(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = {"seconds": 0.0}
    monkeypatch.setattr(api_service_module.time, "time", lambda: clock["seconds"])

    step_check_attempts = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal step_check_attempts
        if request.url.path != "/v1/step/check":
            return httpx.Response(200, json={})

        step_check_attempts += 1
        if step_check_attempts <= 3:
            return httpx.Response(500, json={"error": "down"})
        return httpx.Response(200, json={"decision": "proceed"})

    transport = httpx.MockTransport(handler)
    client = httpx.AsyncClient(transport=transport)
    service = ApiService("test-key", endpoint="https://example.test", client=client)

    await service.send_step_start("run-1", STEP_CHECK)
    await service.send_step_start("run-1", STEP_CHECK)
    await service.send_step_start("run-1", STEP_CHECK)
    await service.send_step_start("run-1", STEP_CHECK)
    assert step_check_attempts == 3

    clock["seconds"] += 60.0
    await service.send_step_start("run-1", STEP_CHECK)
    assert step_check_attempts == 4

    await service.send_step_start("run-1", STEP_CHECK)
    assert step_check_attempts == 5

    await service.disconnect()


@pytest.mark.asyncio
async def test_disconnect_flushes_pending_events() -> None:
    event_payloads: list[dict[str, object]] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/health":
            return httpx.Response(200, json={})
        if request.url.path == "/v1/tools/config":
            return httpx.Response(200, json={"tools": {}})
        if request.url.path == "/v1/events":
            event_payloads.append(_decode_json_request(request))
            return httpx.Response(200, json={})
        return httpx.Response(200, json={})

    transport = httpx.MockTransport(handler)
    client = httpx.AsyncClient(transport=transport)
    service = ApiService("test-key", endpoint="https://example.test", client=client)

    assert await service.connect() is True

    for idx in range(5):
        await service.send_step_end("run-1", f"step-{idx}", STEP_END)

    await service.disconnect()

    assert len(event_payloads) == 1
    payload = event_payloads[0]
    assert "events" in payload
    assert isinstance(payload["events"], list)
    assert len(payload["events"]) == 5


@pytest.mark.asyncio
async def test_refresh_config_uses_ttl_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = {"seconds": 1.0}
    monkeypatch.setattr(api_service_module.time, "time", lambda: clock["seconds"])

    config_get_calls = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal config_get_calls
        if request.url.path == "/v1/tools/config":
            config_get_calls += 1
            return httpx.Response(
                200,
                json={
                    "tools": {
                        "search": {
                            "max_retries": 2,
                            "timeout": 5000,
                            "enabled": True,
                            "updated_at": "2026-01-01T00:00:00Z",
                        }
                    }
                },
            )
        return httpx.Response(200, json={})

    transport = httpx.MockTransport(handler)
    client = httpx.AsyncClient(transport=transport)
    service = ApiService("test-key", endpoint="https://example.test", client=client)

    await service.refresh_config()
    assert config_get_calls == 1

    assert service.get_tool_config("search") is not None
    await service.refresh_config()
    assert config_get_calls == 1

    clock["seconds"] += 300.001
    await service.refresh_config()
    assert config_get_calls == 2

    await service.disconnect()


@pytest.mark.asyncio
async def test_offline_mode_with_empty_api_key_performs_no_http_calls() -> None:
    http_calls = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal http_calls
        http_calls += 1
        return httpx.Response(200, json={})

    transport = httpx.MockTransport(handler)
    client = httpx.AsyncClient(transport=transport)
    service = ApiService("", endpoint="https://example.test", client=client)

    assert await service.connect() is False

    await service.send_run_start("run-1", "agent-1", {})
    await service.send_step_start("run-1", STEP_CHECK)
    await service.send_step_end("run-1", "step-1", STEP_END)
    await service.send_guard_event(
        "run-1",
        {
            "event_type": "loop_detected",
            "severity": "warning",
            "details": {"reason": "test"},
            "step_id": "step-1",
        },
    )
    await service.send_run_end("run-1", "completed")
    await service.refresh_config()
    await service.flush()

    assert http_calls == 0
    assert service.get_tool_config("search") is None

    await service.disconnect()
