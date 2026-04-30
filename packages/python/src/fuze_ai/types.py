from __future__ import annotations

from typing import Any, Callable, Literal, Optional, TypedDict


class ResourceLimits(TypedDict, total=False):
    max_steps: int
    max_tokens_per_run: int
    max_wall_clock_ms: int


class GuardOptions(TypedDict, total=False):
    max_retries: int
    timeout: int
    max_iterations: int
    side_effect: bool
    compensate: Callable[..., Any]
    on_loop: Literal["kill", "warn", "skip"]
    usage_extractor: Callable[..., Any]
    resource_limits: ResourceLimits


class FuzeConfigDefaults(TypedDict, total=False):
    max_retries: int
    timeout: int
    max_iterations: int
    on_loop: Literal["kill", "warn", "skip"]
    trace_output: str


class FuzeConfigLoopDetection(TypedDict, total=False):
    window_size: int
    repeat_threshold: int
    max_flat_steps: int


class FuzeConfigCloud(TypedDict, total=False):
    api_key: str
    apiKey: str
    endpoint: str
    flush_interval_ms: int
    flushIntervalMs: int


class FuzeConfigDaemon(TypedDict, total=False):
    enabled: bool
    socket_path: str
    socketPath: str


class FuzeConfig(TypedDict, total=False):
    defaults: FuzeConfigDefaults
    loop_detection: FuzeConfigLoopDetection
    cloud: FuzeConfigCloud
    daemon: FuzeConfigDaemon
    agent_id: str
    usage_extractor: Callable[..., Any]
    resource_limits: ResourceLimits


class ResolvedOptions(TypedDict):
    max_retries: int
    timeout: float
    max_iterations: int
    on_loop: Literal["kill", "warn", "skip"]
    trace_output: str
    side_effect: bool
    compensate: Optional[Callable[..., Any]]
    usage_extractor: Optional[Callable[..., Any]]
    loop_detection: dict[str, Any]
    resource_limits: ResourceLimits


class StepRecord(TypedDict):
    step_id: str
    run_id: str
    step_number: int
    started_at: str
    ended_at: str
    tool_name: str
    args_hash: str
    has_side_effect: bool
    tokens_in: int
    tokens_out: int
    latency_ms: int
    error: Optional[str]


class GuardEventRecord(TypedDict):
    event_id: str
    run_id: str
    step_id: Optional[str]
    timestamp: str
    type: Literal["loop_detected", "timeout", "kill", "side_effect_blocked", "retry"]
    severity: Literal["warning", "action", "critical"]
    details: dict[str, Any]


class LoopSignal(TypedDict):
    type: Literal["max_iterations", "repeated_tool", "no_progress"]
    details: dict[str, Any]


class CompensationResultBase(TypedDict):
    step_id: str
    tool_name: str
    status: Literal["compensated", "no_compensation", "failed"]
    escalated: bool
    error: Optional[str]


class CompensationResult(CompensationResultBase, total=False):
    compensation_started_at: str
    compensation_ended_at: str
    compensation_latency_ms: int


class ResourceUsageStatus(TypedDict):
    total_tokens_in: int
    total_tokens_out: int
    step_count: int
    wall_clock_ms: int


DEFAULTS: ResolvedOptions = {
    "max_retries": 3,
    "timeout": 30_000,
    "max_iterations": 25,
    "on_loop": "kill",
    "trace_output": "./fuze-traces.jsonl",
    "side_effect": False,
    "compensate": None,
    "usage_extractor": None,
    "loop_detection": {
        "window_size": 5,
        "repeat_threshold": 3,
        "max_flat_steps": 4,
    },
    "resource_limits": {},
}
