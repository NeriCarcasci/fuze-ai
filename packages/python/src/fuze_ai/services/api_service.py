from __future__ import annotations

import asyncio
import time
from typing import Any, Callable, Literal, TypeVar

import httpx

from .types import GuardEventData, StepCheckData, StepEndData, ToolConfig, ToolRegistration

STEP_CHECK_TIMEOUT_MS = 50
DEFAULT_FLUSH_INTERVAL_MS = 5_000
MIN_FLUSH_INTERVAL_MS = 1_000
CONFIG_REFRESH_INTERVAL_MS = 30_000
CONFIG_CACHE_TTL_MS = 5 * 60_000
MAX_BUFFER_SIZE = 10_000
CIRCUIT_BREAKER_FAILURE_THRESHOLD = 3
CIRCUIT_BREAKER_COOLDOWN_MS = 60_000
FLUSH_BACKOFF_MIN_MS = 1_000
FLUSH_BACKOFF_MAX_MS = 30_000

T = TypeVar("T")


class ApiService:
    def __init__(
        self,
        api_key: str,
        endpoint: str = "https://api.fuze-ai.tech",
        flush_interval_ms: int = DEFAULT_FLUSH_INTERVAL_MS,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._api_key = api_key
        self._endpoint = endpoint
        self._flush_interval_ms = max(MIN_FLUSH_INTERVAL_MS, flush_interval_ms)
        self._client = client

        self._config_cache: dict[str, ToolConfig] = {}
        self._buffer: list[dict[str, Any]] = []
        self._connected = False
        self._closed = False

        self._flush_task: asyncio.Task[None] | None = None
        self._refresh_task: asyncio.Task[None] | None = None

        self._config_refreshed_at = 0.0
        self._consecutive_failures = 0
        self._circuit_open_until = 0.0
        self._probe_in_flight = False
        self._flush_backoff_ms = FLUSH_BACKOFF_MIN_MS
        self._next_flush_at = 0.0

    async def connect(self) -> bool:
        if not self._has_api_key():
            self._connected = False
            return False

        healthy = await self._request(
            lambda: self._fetch("/v1/health", headers=self._auth_headers()),
            expect_json=False,
        )
        if healthy is None:
            self._connected = False
            return False

        self._connected = True
        self._closed = False
        self._flush_task = asyncio.create_task(self._flush_loop())
        self._refresh_task = asyncio.create_task(self._refresh_loop())
        await self.refresh_config(force=True)
        return True

    async def disconnect(self) -> None:
        self._closed = True
        if self._flush_task:
            self._flush_task.cancel()
            self._flush_task = None
        if self._refresh_task:
            self._refresh_task.cancel()
            self._refresh_task = None

        await self.flush()
        if self._client:
            await self._client.aclose()
            self._client = None
        self._connected = False

    def is_connected(self) -> bool:
        return self._connected and not self._is_circuit_open(time.time() * 1000) and self._has_api_key()

    async def flush(self) -> None:
        await self._flush_internal(force=True)

    async def register_tools(self, project_id: str, tools: list[ToolRegistration]) -> None:
        if not self._has_api_key():
            return

        await self._request(
            lambda: self._fetch(
                "/v1/tools/register",
                method="POST",
                headers=self._json_headers(),
                json_body={"project_id": project_id, "tools": tools},
            ),
            expect_json=False,
        )

    def get_tool_config(self, tool_name: str) -> ToolConfig | None:
        return self._config_cache.get(tool_name)

    async def refresh_config(self, force: bool = False) -> None:
        if not self._has_api_key():
            return
        now = time.time() * 1000
        if not force and self._config_refreshed_at and now - self._config_refreshed_at < CONFIG_CACHE_TTL_MS:
            return

        data = await self._request(
            lambda: self._fetch(
                "/v1/tools/config",
                headers=self._auth_headers(),
            ),
        )
        if not isinstance(data, dict):
            return
        tools = data.get("tools")
        if not isinstance(tools, dict):
            return

        self._config_cache = tools  # type: ignore[assignment]
        self._config_refreshed_at = time.time() * 1000

    async def send_run_start(self, run_id: str, agent_id: str, config: dict[str, Any]) -> None:
        self._enqueue({"type": "run_start", "run_id": run_id, "agent_id": agent_id, "config": config})

    async def send_step_start(self, run_id: str, step: StepCheckData) -> Literal["proceed", "kill", "pause"]:
        if not self._has_api_key():
            return "proceed"

        data = await self._request(
            lambda: self._fetch(
                "/v1/step/check",
                method="POST",
                headers=self._json_headers(),
                json_body={"run_id": run_id, "step": step},
                timeout_s=STEP_CHECK_TIMEOUT_MS / 1000,
            ),
        )
        if not isinstance(data, dict):
            return "proceed"
        decision = data.get("decision")
        if decision in {"kill", "pause"}:
            return decision
        return "proceed"

    async def send_step_end(self, run_id: str, step_id: str, data: StepEndData) -> None:
        self._enqueue({"type": "step_end", "run_id": run_id, "step_id": step_id, **data})

    async def send_guard_event(self, run_id: str, event: GuardEventData) -> None:
        self._enqueue({"type": "guard_event", "run_id": run_id, **event})

    async def send_run_end(self, run_id: str, status: str) -> None:
        self._enqueue({"type": "run_end", "run_id": run_id, "status": status})
        await self.flush()

    async def _flush_loop(self) -> None:
        try:
            while not self._closed:
                await asyncio.sleep(self._flush_interval_ms / 1000)
                await self._flush_internal(force=False)
        except asyncio.CancelledError:
            return

    async def _refresh_loop(self) -> None:
        try:
            while not self._closed:
                await asyncio.sleep(CONFIG_REFRESH_INTERVAL_MS / 1000)
                await self.refresh_config()
        except asyncio.CancelledError:
            return

    async def _flush_internal(self, force: bool) -> bool:
        if not self._buffer:
            return True
        if not self._has_api_key():
            return True
        now = time.time() * 1000
        if not force and now < self._next_flush_at:
            return False

        events = list(self._buffer)
        self._buffer = []

        sent = await self._request(
            lambda: self._fetch(
                "/v1/events",
                method="POST",
                headers=self._json_headers(),
                json_body={"events": events},
            ),
            expect_json=False,
        )
        if sent is not None:
            self._flush_backoff_ms = FLUSH_BACKOFF_MIN_MS
            self._next_flush_at = 0
            return True

        if len(self._buffer) + len(events) <= MAX_BUFFER_SIZE:
            self._buffer = events + self._buffer
        self._next_flush_at = time.time() * 1000 + self._flush_backoff_ms
        self._flush_backoff_ms = min(self._flush_backoff_ms * 2, FLUSH_BACKOFF_MAX_MS)
        return False

    def _enqueue(self, event: dict[str, Any]) -> None:
        if not self._has_api_key():
            return
        if len(self._buffer) < MAX_BUFFER_SIZE:
            self._buffer.append(event)

    async def _fetch(
        self,
        path: str,
        *,
        method: str = "GET",
        headers: dict[str, str] | None = None,
        json_body: dict[str, Any] | None = None,
        timeout_s: float | None = 5.0,
    ) -> Any:
        client = await self._get_client()
        response = await client.request(
            method,
            f"{self._endpoint}{path}",
            headers=headers,
            json=json_body,
            timeout=timeout_s,
        )
        if response.status_code < 200 or response.status_code >= 300:
            raise RuntimeError(f"HTTP {response.status_code}")
        return response.json() if response.content else {}

    async def _request(self, operation: Callable[[], "asyncio.Future[T] | Any"], expect_json: bool = True) -> T | None:
        if not self._has_api_key():
            return None

        now = time.time() * 1000
        if self._is_circuit_open(now):
            return None

        is_probe = self._is_half_open(now)
        if is_probe and self._probe_in_flight:
            return None
        if is_probe:
            self._probe_in_flight = True

        try:
            result = await operation()
            self._on_request_success()
            return result
        except Exception:
            self._on_request_failure()
            return None
        finally:
            if is_probe:
                self._probe_in_flight = False

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient()
        return self._client

    def _is_circuit_open(self, now_ms: float) -> bool:
        return self._circuit_open_until > now_ms

    def _is_half_open(self, now_ms: float) -> bool:
        return self._circuit_open_until != 0 and now_ms >= self._circuit_open_until

    def _on_request_success(self) -> None:
        self._consecutive_failures = 0
        self._circuit_open_until = 0

    def _on_request_failure(self) -> None:
        self._consecutive_failures += 1
        if self._consecutive_failures >= CIRCUIT_BREAKER_FAILURE_THRESHOLD:
            self._consecutive_failures = CIRCUIT_BREAKER_FAILURE_THRESHOLD
            self._circuit_open_until = time.time() * 1000 + CIRCUIT_BREAKER_COOLDOWN_MS

    def _has_api_key(self) -> bool:
        return bool(self._api_key.strip())

    def _auth_headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._api_key}"}

    def _json_headers(self) -> dict[str, str]:
        return {
            **self._auth_headers(),
            "Content-Type": "application/json",
        }
