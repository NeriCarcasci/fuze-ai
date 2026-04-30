from __future__ import annotations

from typing import Any, Literal

from .types import FuzeService, GuardEventData, StepCheckData, StepEndData, ToolConfig, ToolRegistration


class NoopService(FuzeService):
    async def connect(self) -> bool:
        return True

    async def disconnect(self) -> None:
        return None

    def is_connected(self) -> bool:
        return True

    async def flush(self) -> None:
        return None

    async def register_tools(self, project_id: str, tools: list[ToolRegistration]) -> None:
        return None

    def get_tool_config(self, tool_name: str) -> ToolConfig | None:
        return None

    async def refresh_config(self, force: bool = False) -> None:
        return None

    async def send_run_start(self, run_id: str, agent_id: str, config: dict[str, Any]) -> None:
        return None

    async def send_step_start(self, run_id: str, step: StepCheckData) -> Literal["proceed", "kill", "pause"]:
        return "proceed"

    async def send_step_end(self, run_id: str, step_id: str, data: StepEndData) -> None:
        return None

    async def send_guard_event(self, run_id: str, event: GuardEventData) -> None:
        return None

    async def send_run_end(self, run_id: str, status: str) -> None:
        return None
