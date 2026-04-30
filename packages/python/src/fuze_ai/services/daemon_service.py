from __future__ import annotations

import asyncio
import json
import os
import tempfile
from typing import Any, Literal

from .noop_service import NoopService
from .types import GuardEventData, StepCheckData, StepEndData, ToolConfig, ToolRegistration

STEP_TIMEOUT_MS = 10
CONFIG_TIMEOUT_MS = 2_000


def get_default_socket_path() -> str:
    return os.path.join(tempfile.gettempdir(), "fuze-daemon.sock")


class DaemonService:
    """Thin async daemon transport over UDS with noop fallback semantics."""

    def __init__(self, socket_path: str | None = None) -> None:
        self._socket_path = socket_path or get_default_socket_path()
        self._config_cache: dict[str, ToolConfig] = {}
        self._connected = False
        self._closed = False

        self._reader: asyncio.StreamReader | None = None
        self._writer: asyncio.StreamWriter | None = None
        self._read_task: asyncio.Task[None] | None = None
        self._write_lock = asyncio.Lock()

        self._pending_step: asyncio.Future[Literal["proceed", "kill", "pause"]] | None = None
        self._pending_config: asyncio.Future[dict[str, ToolConfig]] | None = None
        self._fallback = NoopService()

    async def connect(self) -> bool:
        if self._connected:
            return True
        if self._closed:
            return False
        if not hasattr(asyncio, "open_unix_connection"):
            self._connected = False
            return False

        try:
            self._reader, self._writer = await asyncio.open_unix_connection(self._socket_path)
        except Exception:
            self._connected = False
            return False

        self._connected = True
        self._read_task = asyncio.create_task(self._read_loop())
        await self.refresh_config(force=True)
        return True

    async def disconnect(self) -> None:
        self._closed = True
        self._connected = False
        self._resolve_pending_step_default()
        self._resolve_pending_config_default()

        if self._read_task:
            self._read_task.cancel()
            self._read_task = None

        writer = self._writer
        self._writer = None
        self._reader = None
        if writer is not None:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass

    def is_connected(self) -> bool:
        return self._connected

    async def flush(self) -> None:
        return None

    async def register_tools(self, project_id: str, tools: list[ToolRegistration]) -> None:
        if not self._connected:
            await self._fallback.register_tools(project_id, tools)
            return

        payload_tools = []
        for tool in tools:
            defaults = tool.get("defaults", {})
            payload_tools.append(
                {
                    "name": tool.get("name", ""),
                    "description": tool.get("description", ""),
                    "schema": tool.get("schema", {}),
                    "sideEffect": bool(tool.get("side_effect", False)),
                    "defaults": {
                        "maxRetries": int(defaults.get("max_retries", 3)),
                        "timeout": int(defaults.get("timeout", 30_000)),
                    },
                }
            )

        await self._send({"type": "register_tools", "projectId": project_id, "tools": payload_tools})

    def get_tool_config(self, tool_name: str) -> ToolConfig | None:
        return self._config_cache.get(tool_name)

    async def refresh_config(self, force: bool = False) -> None:
        if not self._connected:
            await self._fallback.refresh_config(force=force)
            return
        if self._pending_config is not None and not self._pending_config.done():
            return

        loop = asyncio.get_running_loop()
        pending = loop.create_future()
        self._pending_config = pending

        sent = await self._send({"type": "get_config"})
        if not sent:
            self._pending_config = None
            if not pending.done():
                pending.set_result({})
            return

        try:
            tools = await asyncio.wait_for(pending, timeout=CONFIG_TIMEOUT_MS / 1000)
        except asyncio.TimeoutError:
            if self._pending_config is pending:
                self._pending_config = None
            return

        self._config_cache = dict(tools)

    async def send_run_start(self, run_id: str, agent_id: str, config: dict[str, Any]) -> None:
        if not self._connected:
            await self._fallback.send_run_start(run_id, agent_id, config)
            return
        await self._send({"type": "run_start", "runId": run_id, "agentId": agent_id, "config": config})

    async def send_step_start(self, run_id: str, step: StepCheckData) -> Literal["proceed", "kill", "pause"]:
        if not self._connected:
            return await self._fallback.send_step_start(run_id, step)
        if self._pending_step is not None and not self._pending_step.done():
            return "proceed"

        loop = asyncio.get_running_loop()
        pending = loop.create_future()
        self._pending_step = pending

        sent = await self._send(
            {
                "type": "step_start",
                "runId": run_id,
                "stepId": step["step_id"],
                "stepNumber": step["step_number"],
                "toolName": step["tool_name"],
                "argsHash": step["args_hash"],
                "sideEffect": step["side_effect"],
            }
        )
        if not sent:
            self._pending_step = None
            if not pending.done():
                pending.set_result("proceed")
            return "proceed"

        try:
            return await asyncio.wait_for(pending, timeout=STEP_TIMEOUT_MS / 1000)
        except asyncio.TimeoutError:
            if self._pending_step is pending:
                self._pending_step = None
            return "proceed"

    async def send_step_end(self, run_id: str, step_id: str, data: StepEndData) -> None:
        if not self._connected:
            await self._fallback.send_step_end(run_id, step_id, data)
            return
        await self._send(
            {
                "type": "step_end",
                "runId": run_id,
                "stepId": step_id,
                "tokensIn": data["tokens_in"],
                "tokensOut": data["tokens_out"],
                "latencyMs": data["latency_ms"],
                "error": data["error"],
            }
        )

    async def send_guard_event(self, run_id: str, event: GuardEventData) -> None:
        if not self._connected:
            await self._fallback.send_guard_event(run_id, event)
            return
        await self._send(
            {
                "type": "guard_event",
                "runId": run_id,
                "stepId": event.get("step_id"),
                "eventType": event["event_type"],
                "severity": event["severity"],
                "details": event["details"],
            }
        )

    async def send_run_end(self, run_id: str, status: str) -> None:
        if not self._connected:
            await self._fallback.send_run_end(run_id, status)
            return
        await self._send({"type": "run_end", "runId": run_id, "status": status})

    async def _send(self, payload: dict[str, Any]) -> bool:
        if not self._connected or self._writer is None:
            return False
        message = json.dumps(payload, separators=(",", ":")) + "\n"
        try:
            async with self._write_lock:
                self._writer.write(message.encode("utf-8"))
                await self._writer.drain()
            return True
        except Exception:
            self._connected = False
            return False

    async def _read_loop(self) -> None:
        reader = self._reader
        if reader is None:
            return
        try:
            while not self._closed:
                raw = await reader.readline()
                if not raw:
                    break
                line = raw.decode("utf-8", errors="replace").strip()
                if line:
                    self._on_message(line)
        except asyncio.CancelledError:
            return
        except Exception:
            pass
        finally:
            self._connected = False
            self._resolve_pending_config_default()
            self._resolve_pending_step_default()

    def _on_message(self, line: str) -> None:
        try:
            parsed = json.loads(line)
        except Exception:
            self._resolve_pending_config_default()
            self._resolve_pending_step_default()
            return

        if parsed.get("type") == "config" and self._pending_config is not None:
            pending = self._pending_config
            self._pending_config = None
            tools = parsed.get("tools", {})
            if not isinstance(tools, dict):
                tools = {}
            if not pending.done():
                pending.set_result(tools)
            return

        if self._pending_step is not None:
            pending_step = self._pending_step
            self._pending_step = None
            if pending_step.done():
                return
            msg_type = parsed.get("type")
            if msg_type == "kill":
                pending_step.set_result("kill")
            elif msg_type == "pause":
                pending_step.set_result("pause")
            else:
                pending_step.set_result("proceed")

    def _resolve_pending_step_default(self) -> None:
        if self._pending_step is None:
            return
        pending = self._pending_step
        self._pending_step = None
        if not pending.done():
            pending.set_result("proceed")

    def _resolve_pending_config_default(self) -> None:
        if self._pending_config is None:
            return
        pending = self._pending_config
        self._pending_config = None
        if not pending.done():
            pending.set_result({})
