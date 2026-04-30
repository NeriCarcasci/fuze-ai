from __future__ import annotations

import pytest
from fuze_ai.config_loader import ConfigLoader
from fuze_ai.types import DEFAULTS


def test_missing_toml_returns_empty_config():
    config = ConfigLoader.load("/nonexistent/path/fuze.toml")
    assert config == {}


def test_merge_uses_defaults_when_no_config():
    resolved = ConfigLoader.merge({}, {})

    assert resolved["max_retries"] == DEFAULTS["max_retries"]
    assert resolved["timeout"] == DEFAULTS["timeout"]
    assert resolved["max_iterations"] == DEFAULTS["max_iterations"]
    assert resolved["on_loop"] == DEFAULTS["on_loop"]
    assert resolved["resource_limits"] == {}


def test_toml_values_override_defaults(tmp_path):
    toml_path = tmp_path / "fuze.toml"
    toml_path.write_text(
        "[defaults]\nmax_retries = 7\ntimeout = 99000\n",
        encoding="utf-8",
    )

    config = ConfigLoader.load(str(toml_path))
    resolved = ConfigLoader.merge(config, {})

    assert resolved["max_retries"] == 7
    assert resolved["timeout"] == 99000
    assert resolved["max_iterations"] == DEFAULTS["max_iterations"]


def test_guard_options_override_toml():
    project_config = {
        "defaults": {"max_retries": 10, "timeout": 60000}
    }

    resolved = ConfigLoader.merge(project_config, {"max_retries": 1, "timeout": 1000})

    assert resolved["max_retries"] == 1
    assert resolved["timeout"] == 1000


def test_invalid_toml_raises_with_path(tmp_path):
    bad_path = tmp_path / "fuze.toml"
    bad_path.write_text("this is {{{{ not valid toml", encoding="utf-8")

    with pytest.raises((ValueError, Exception)) as exc_info:
        ConfigLoader.load(str(bad_path))

    assert str(bad_path) in str(exc_info.value) or "fuze.toml" in str(exc_info.value).lower()


def test_loop_detection_config_merged():
    project_config = {
        "loop_detection": {"window_size": 10, "repeat_threshold": 5}
    }

    resolved = ConfigLoader.merge(project_config, {})

    assert resolved["loop_detection"]["window_size"] == 10
    assert resolved["loop_detection"]["repeat_threshold"] == 5
    assert resolved["loop_detection"]["max_flat_steps"] == DEFAULTS["loop_detection"]["max_flat_steps"]


def test_merge_preserves_explicit_zero_values():
    project_config = {"defaults": {"max_retries": 0}}
    resolved = ConfigLoader.merge(project_config, {})
    assert resolved["max_retries"] == 0


def test_load_rejects_malformed_numeric_fields(tmp_path):
    toml_path = tmp_path / "fuze.toml"
    toml_path.write_text(
        "[defaults]\ntimeout = 'fast'\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError) as exc_info:
        ConfigLoader.load(str(toml_path))
    assert "defaults.timeout" in str(exc_info.value)


def test_load_rejects_invalid_on_loop_values(tmp_path):
    toml_path = tmp_path / "fuze.toml"
    toml_path.write_text(
        "[defaults]\non_loop = 'halt'\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError) as exc_info:
        ConfigLoader.load(str(toml_path))
    assert "defaults.on_loop" in str(exc_info.value)


def test_resource_limits_from_toml(tmp_path):
    toml_path = tmp_path / "fuze.toml"
    toml_path.write_text(
        "[resource_limits]\nmax_steps = 10\nmax_tokens_per_run = 5000\nmax_wall_clock_ms = 60000\n",
        encoding="utf-8",
    )

    config = ConfigLoader.load(str(toml_path))
    resolved = ConfigLoader.merge(config, {})

    assert resolved["resource_limits"] == {
        "max_steps": 10,
        "max_tokens_per_run": 5000,
        "max_wall_clock_ms": 60000,
    }


def test_resource_limits_guard_option_merges_with_project():
    project_config = {"resource_limits": {"max_steps": 10, "max_wall_clock_ms": 60000}}
    resolved = ConfigLoader.merge(project_config, {"resource_limits": {"max_steps": 5}})

    assert resolved["resource_limits"]["max_steps"] == 5
    assert resolved["resource_limits"]["max_wall_clock_ms"] == 60000


def test_resource_limits_rejects_non_integer(tmp_path):
    toml_path = tmp_path / "fuze.toml"
    toml_path.write_text(
        "[resource_limits]\nmax_steps = 2.5\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError) as exc_info:
        ConfigLoader.load(str(toml_path))
    assert "max_steps" in str(exc_info.value)


def test_resource_limits_rejects_zero():
    with pytest.raises(ValueError):
        ConfigLoader.merge({}, {"resource_limits": {"max_steps": 0}})
