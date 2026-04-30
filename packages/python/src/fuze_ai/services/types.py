from __future__ import annotations

from typing import Any, Literal, Protocol, TypedDict


class StepCheckData(TypedDict):
    step_id: str
    step_number: int
    tool_name: str
    args_hash: str
    side_effect: bool


class StepEndData(TypedDict):
    tool_name: str
    step_number: int
    args_hash: str
    has_side_effect: bool
    tokens_in: int
    tokens_out: int
    latency_ms: int
    error: str | None


class GuardEventData(TypedDict):
    event_type: str
    severity: str
    details: dict[str, Any]
    step_id: str | None


class ToolRegistration(TypedDict):
    name: str
    description: str
    schema: dict[str, Any]
    side_effect: bool
    defaults: dict[str, Any]


class ToolConfig(TypedDict):
    max_retries: int
    timeout: int
    enabled: bool
    updated_at: str


class FuzeService(Protocol):
    async def connect(self) -> bool: ...
    async def disconnect(self) -> None: ...
    def is_connected(self) -> bool: ...
    async def flush(self) -> None: ...

    async def register_tools(self, project_id: str, tools: list[ToolRegistration]) -> None: ...
    def get_tool_config(self, tool_name: str) -> ToolConfig | None: ...
    async def refresh_config(self, force: bool = False) -> None: ...

    async def send_run_start(self, run_id: str, agent_id: str, config: dict[str, Any]) -> None: ...
    async def send_step_start(self, run_id: str, step: StepCheckData) -> Literal["proceed", "kill", "pause"]: ...
    async def send_step_end(self, run_id: str, step_id: str, data: StepEndData) -> None: ...
    async def send_guard_event(self, run_id: str, event: GuardEventData) -> None: ...
    async def send_run_end(self, run_id: str, status: str) -> None: ...
