from __future__ import annotations

import pytest

from fuze_ai.services import create_service
from fuze_ai.services.daemon_service import DaemonService


@pytest.mark.asyncio
async def test_daemon_service_falls_back_to_noop_when_connection_fails():
    service = DaemonService("/tmp/fuze-daemon-missing.sock")

    assert await service.connect() is False
    decision = await service.send_step_start(
        "run-1",
        {
            "step_id": "step-1",
            "step_number": 1,
            "tool_name": "search",
            "args_hash": "abc123",
            "side_effect": False,
        },
    )
    assert decision == "proceed"


def test_create_service_returns_daemon_when_enabled_without_api_key():
    service = create_service({"daemon": {"enabled": True}})
    assert isinstance(service, DaemonService)
