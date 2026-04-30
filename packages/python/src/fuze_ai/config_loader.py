from __future__ import annotations

import math
import sys
from pathlib import Path
from typing import Any, Optional

from fuze_ai.types import DEFAULTS, FuzeConfig, ResolvedOptions, ResourceLimits


def _load_toml(path: Path) -> dict[str, Any]:
    if sys.version_info >= (3, 11):
        import tomllib

        with path.open("rb") as fh:
            return tomllib.load(fh)
    try:
        import tomli  # type: ignore[import]

        with path.open("rb") as fh:
            return tomli.load(fh)
    except ImportError as exc:
        raise ImportError(
            "TOML parsing requires 'tomli' on Python < 3.11. Install it: pip install tomli"
        ) from exc


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _read_number(
    value: Any,
    field_path: str,
    *,
    integer: bool = False,
    min_value: float = 0.0,
    allow_infinity: bool = False,
) -> int | float:
    if not _is_number(value):
        raise ValueError(f"Invalid '{field_path}': expected a numeric value")
    if math.isnan(float(value)):
        raise ValueError(f"Invalid '{field_path}': NaN is not allowed")
    if not allow_infinity and not math.isfinite(float(value)):
        raise ValueError(f"Invalid '{field_path}': expected a finite number")
    if float(value) < min_value:
        raise ValueError(f"Invalid '{field_path}': expected a value >= {min_value}")
    if integer and int(value) != float(value):
        raise ValueError(f"Invalid '{field_path}': expected an integer")
    return int(value) if integer else float(value)


def _read_string(value: Any, field_path: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Invalid '{field_path}': expected a non-empty string")
    return value


def _read_on_loop(value: Any, field_path: str) -> str:
    if value in {"kill", "warn", "skip"}:
        return str(value)
    raise ValueError(f"Invalid '{field_path}': expected one of 'kill', 'warn', or 'skip'")


def _coalesce(*values: Any) -> Any:
    for value in values:
        if value is not None:
            return value
    return None


def _validate_resource_limits(raw: Any, field_path: str) -> ResourceLimits:
    if not isinstance(raw, dict):
        raise ValueError(f"Invalid '{field_path}': expected a table/object")
    result: ResourceLimits = {}
    if "max_steps" in raw:
        result["max_steps"] = int(_read_number(
            raw["max_steps"], f"{field_path}.max_steps", integer=True, min_value=1
        ))
    if "max_tokens_per_run" in raw:
        result["max_tokens_per_run"] = int(_read_number(
            raw["max_tokens_per_run"], f"{field_path}.max_tokens_per_run", integer=True, min_value=1
        ))
    if "max_wall_clock_ms" in raw:
        result["max_wall_clock_ms"] = int(_read_number(
            raw["max_wall_clock_ms"], f"{field_path}.max_wall_clock_ms", integer=True, min_value=1
        ))
    return result


def _validate_config(raw: dict[str, Any]) -> FuzeConfig:
    config: FuzeConfig = {}

    defaults = raw.get("defaults")
    if defaults is not None:
        if not isinstance(defaults, dict):
            raise ValueError("Invalid 'defaults': expected a table/object")
        validated_defaults: dict[str, Any] = {}
        if "max_retries" in defaults:
            validated_defaults["max_retries"] = _read_number(defaults["max_retries"], "defaults.max_retries", integer=True, min_value=0)
        if "timeout" in defaults:
            validated_defaults["timeout"] = _read_number(defaults["timeout"], "defaults.timeout", min_value=0, allow_infinity=True)
        if "max_iterations" in defaults:
            validated_defaults["max_iterations"] = _read_number(defaults["max_iterations"], "defaults.max_iterations", integer=True, min_value=1)
        if "on_loop" in defaults:
            validated_defaults["on_loop"] = _read_on_loop(defaults["on_loop"], "defaults.on_loop")
        if "trace_output" in defaults:
            validated_defaults["trace_output"] = _read_string(defaults["trace_output"], "defaults.trace_output")
        config["defaults"] = validated_defaults  # type: ignore[assignment]

    loop_detection = raw.get("loop_detection")
    if loop_detection is not None:
        if not isinstance(loop_detection, dict):
            raise ValueError("Invalid 'loop_detection': expected a table/object")
        validated_loop: dict[str, Any] = {}
        if "window_size" in loop_detection:
            validated_loop["window_size"] = _read_number(loop_detection["window_size"], "loop_detection.window_size", integer=True, min_value=1)
        if "repeat_threshold" in loop_detection:
            validated_loop["repeat_threshold"] = _read_number(loop_detection["repeat_threshold"], "loop_detection.repeat_threshold", integer=True, min_value=1)
        if "max_flat_steps" in loop_detection:
            validated_loop["max_flat_steps"] = _read_number(loop_detection["max_flat_steps"], "loop_detection.max_flat_steps", integer=True, min_value=1)
        config["loop_detection"] = validated_loop  # type: ignore[assignment]

    if "resource_limits" in raw:
        config["resource_limits"] = _validate_resource_limits(raw["resource_limits"], "resource_limits")

    cloud = raw.get("cloud")
    if cloud is not None:
        if not isinstance(cloud, dict):
            raise ValueError("Invalid 'cloud': expected a table/object")
        validated_cloud: dict[str, Any] = {}
        if "api_key" in cloud:
            if not isinstance(cloud["api_key"], str):
                raise ValueError("Invalid 'cloud.api_key': expected a string")
            validated_cloud["api_key"] = cloud["api_key"]
        if "apiKey" in cloud:
            if not isinstance(cloud["apiKey"], str):
                raise ValueError("Invalid 'cloud.apiKey': expected a string")
            validated_cloud["apiKey"] = cloud["apiKey"]
        if "endpoint" in cloud:
            validated_cloud["endpoint"] = _read_string(cloud["endpoint"], "cloud.endpoint")
        if "flush_interval_ms" in cloud:
            validated_cloud["flush_interval_ms"] = _read_number(
                cloud["flush_interval_ms"], "cloud.flush_interval_ms", integer=True, min_value=1000,
            )
        if "flushIntervalMs" in cloud:
            validated_cloud["flushIntervalMs"] = _read_number(
                cloud["flushIntervalMs"], "cloud.flushIntervalMs", integer=True, min_value=1000,
            )
        config["cloud"] = validated_cloud  # type: ignore[assignment]

    daemon = raw.get("daemon")
    if daemon is not None:
        if not isinstance(daemon, dict):
            raise ValueError("Invalid 'daemon': expected a table/object")
        validated_daemon: dict[str, Any] = {}
        if "enabled" in daemon:
            if not isinstance(daemon["enabled"], bool):
                raise ValueError("Invalid 'daemon.enabled': expected a boolean")
            validated_daemon["enabled"] = daemon["enabled"]
        if "socket_path" in daemon:
            validated_daemon["socket_path"] = _read_string(daemon["socket_path"], "daemon.socket_path")
        if "socketPath" in daemon:
            validated_daemon["socketPath"] = _read_string(daemon["socketPath"], "daemon.socketPath")
        config["daemon"] = validated_daemon  # type: ignore[assignment]

    if "agent_id" in raw:
        config["agent_id"] = _read_string(raw["agent_id"], "agent_id")

    return config


class ConfigLoader:
    @staticmethod
    def load(path: Optional[str] = None) -> FuzeConfig:
        config_path = Path(path) if path else Path("./fuze.toml")

        if not config_path.exists():
            return {}

        try:
            raw = _load_toml(config_path)
            if not isinstance(raw, dict):
                raise ValueError("Invalid config root: expected a table/object")
            return _validate_config(raw)
        except ImportError:
            raise
        except Exception as exc:
            raise ValueError(
                f"Failed to parse Fuze config at '{config_path}': {exc}"
            ) from exc

    @staticmethod
    def merge(project_config: FuzeConfig, guard_options: dict[str, Any]) -> ResolvedOptions:
        cfg = project_config.get("defaults") or {}
        loop = project_config.get("loop_detection") or {}
        dl = DEFAULTS["loop_detection"]

        max_retries = _read_number(
            _coalesce(guard_options.get("max_retries"), cfg.get("max_retries"), DEFAULTS["max_retries"]),
            "max_retries",
            integer=True,
            min_value=0,
        )
        timeout = _read_number(
            _coalesce(guard_options.get("timeout"), cfg.get("timeout"), DEFAULTS["timeout"]),
            "timeout",
            min_value=0,
            allow_infinity=True,
        )
        max_iterations = _read_number(
            _coalesce(guard_options.get("max_iterations"), cfg.get("max_iterations"), DEFAULTS["max_iterations"]),
            "max_iterations",
            integer=True,
            min_value=1,
        )
        on_loop = _read_on_loop(
            _coalesce(guard_options.get("on_loop"), cfg.get("on_loop"), DEFAULTS["on_loop"]),
            "on_loop",
        )
        trace_output = _read_string(
            _coalesce(cfg.get("trace_output"), DEFAULTS["trace_output"]),
            "trace_output",
        )
        side_effect_raw = guard_options.get("side_effect", DEFAULTS["side_effect"])
        if not isinstance(side_effect_raw, bool):
            raise ValueError("Invalid 'side_effect': expected a boolean")

        compensate = guard_options.get("compensate")
        if compensate is not None and not callable(compensate):
            raise ValueError("Invalid 'compensate': expected a callable")

        usage_extractor = _coalesce(
            guard_options.get("usage_extractor"),
            project_config.get("usage_extractor"),
        )
        if usage_extractor is not None and not callable(usage_extractor):
            raise ValueError("Invalid 'usage_extractor': expected a callable")

        loop_window_size = _read_number(
            _coalesce(loop.get("window_size"), dl["window_size"]),
            "loop_detection.window_size",
            integer=True,
            min_value=1,
        )
        loop_repeat_threshold = _read_number(
            _coalesce(loop.get("repeat_threshold"), dl["repeat_threshold"]),
            "loop_detection.repeat_threshold",
            integer=True,
            min_value=1,
        )
        loop_max_flat_steps = _read_number(
            _coalesce(loop.get("max_flat_steps"), dl["max_flat_steps"]),
            "loop_detection.max_flat_steps",
            integer=True,
            min_value=1,
        )

        project_limits = project_config.get("resource_limits") or {}
        guard_limits_raw = guard_options.get("resource_limits")
        guard_limits = (
            _validate_resource_limits(guard_limits_raw, "resource_limits")
            if guard_limits_raw is not None
            else {}
        )
        resource_limits: ResourceLimits = {**project_limits, **guard_limits}  # type: ignore[misc]

        return ResolvedOptions(
            max_retries=int(max_retries),
            timeout=float(timeout),
            max_iterations=int(max_iterations),
            on_loop=on_loop,
            trace_output=trace_output,
            side_effect=side_effect_raw,
            compensate=compensate,
            usage_extractor=usage_extractor,
            loop_detection={
                "window_size": int(loop_window_size),
                "repeat_threshold": int(loop_repeat_threshold),
                "max_flat_steps": int(loop_max_flat_steps),
            },
            resource_limits=resource_limits,
        )
