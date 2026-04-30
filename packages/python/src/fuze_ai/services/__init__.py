from __future__ import annotations

import os
from typing import Any

from .api_service import ApiService
from .daemon_service import DaemonService
from .noop_service import NoopService
from .types import FuzeService, GuardEventData, StepCheckData, StepEndData, ToolConfig, ToolRegistration

__all__ = [
    "FuzeService",
    "ToolRegistration",
    "ToolConfig",
    "StepCheckData",
    "StepEndData",
    "GuardEventData",
    "ApiService",
    "DaemonService",
    "NoopService",
    "create_service",
]


def create_service(config: dict[str, Any]) -> FuzeService:
    cloud = config.get("cloud") if isinstance(config, dict) else None
    cloud = cloud if isinstance(cloud, dict) else {}
    daemon = config.get("daemon") if isinstance(config, dict) else None
    daemon = daemon if isinstance(daemon, dict) else {}
    api_key = cloud.get("api_key") or cloud.get("apiKey") or os.getenv("FUZE_API_KEY") or ""
    endpoint = cloud.get("endpoint") or "https://api.fuze-ai.tech"
    flush_interval_ms = cloud.get("flush_interval_ms") or cloud.get("flushIntervalMs") or 5_000

    if isinstance(api_key, str) and api_key.strip():
        return ApiService(
            api_key=api_key,
            endpoint=str(endpoint),
            flush_interval_ms=int(flush_interval_ms),
        )

    daemon_enabled = daemon.get("enabled")
    if daemon_enabled is None:
        daemon_enabled = os.getenv("FUZE_DAEMON_ENABLED", "").strip().lower() in {"1", "true", "yes"}
    socket_path = (
        daemon.get("socket_path")
        or daemon.get("socketPath")
        or os.getenv("FUZE_DAEMON_SOCKET")
        or None
    )
    if daemon_enabled:
        return DaemonService(socket_path=str(socket_path) if socket_path else None)

    return NoopService()
