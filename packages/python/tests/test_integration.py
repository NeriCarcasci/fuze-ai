"""Integration tests for Fuze AI Phase 2."""
from __future__ import annotations

import asyncio
import json
import os
import time
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fuze_ai import configure, create_run, guard, reset_config
from fuze_ai.adapters.langgraph import fuze_tool
from fuze_ai.adapters.raw import fuze_dispatch
from fuze_ai.config_loader import ConfigLoader
from fuze_ai.errors import GuardTimeout, LoopDetected, ResourceLimitExceeded


@pytest.fixture
def trace_file(tmp_path) -> str:
    return str(tmp_path / "integration-trace.jsonl")


def test_sync_guarded_function_completes_and_produces_trace(trace_file):
    """Sync guarded function completes normally and produces a trace."""
    configure({"defaults": {"trace_output": trace_file}})

    run = create_run({"agent_id": "test-agent"})

    @run.guard
    def search(query: str) -> dict:
        return {"results": [f"result for {query}"]}

    result = search("hello")
    assert result == {"results": ["result for hello"]}

    run.end()

    content = Path(trace_file).read_text()
    lines = content.strip().split("\n")
    assert len(lines) >= 3  # run_start + step + run_end

    records = [json.loads(l) for l in lines]
    assert records[0]["record_type"] == "run_start"
    assert records[-1]["record_type"] == "run_end"


@pytest.mark.asyncio
async def test_async_guarded_function_completes_and_produces_trace(trace_file):
    """Async guarded function completes normally and produces a trace."""
    configure({"defaults": {"trace_output": trace_file}})

    run = create_run({"agent_id": "async-agent"})

    @run.guard
    async def async_search(query: str) -> list:
        return [f"async result: {query}"]

    result = await async_search("test")
    assert result == ["async result: test"]

    run.end()

    assert Path(trace_file).exists()
    lines = Path(trace_file).read_text().strip().split("\n")
    records = [json.loads(l) for l in lines]
    assert any(r["record_type"] == "step" for r in records)


def test_guard_no_parens_identical_to_guard_with_parens():
    """@guard and @guard() work identically."""
    @guard
    def fn1(x):
        return x * 2

    @guard()
    def fn2(x):
        return x * 2

    assert fn1(5) == fn2(5) == 10


def test_resource_limit_throws_before_execution(trace_file):
    configure({"defaults": {"trace_output": trace_file}, "resource_limits": {"max_steps": 1}})

    run = create_run()
    called = []

    @run.guard
    def step(n):
        called.append(n)
        return n

    step(1)
    with pytest.raises(ResourceLimitExceeded):
        step(2)

    assert called == [1]


def test_loop_detected_and_killed(trace_file):
    """Guarded function loops and raises LoopDetected."""
    configure({
        "defaults": {"trace_output": trace_file, "max_iterations": 3},
        "loop_detection": {"repeat_threshold": 100, "window_size": 100},
    })

    run = create_run()

    counter = [0]

    @run.guard
    def step(n):
        return f"result-{n}"

    step(1)
    step(2)
    step(3)

    with pytest.raises(LoopDetected):
        step(4)


def test_side_effect_recorded_in_trace(trace_file):
    """Side-effect function is recorded with has_side_effect=True."""
    configure({"defaults": {"trace_output": trace_file}})

    run = create_run({"agent_id": "side-effect-test"})
    rollback_calls = []

    @run.guard(side_effect=True, compensate=lambda r: rollback_calls.append(r))
    def send_email(to: str) -> dict:
        return {"message_id": f"msg-to-{to}"}

    send_email("alice@example.com")
    run.end()

    content = Path(trace_file).read_text().strip().split("\n")
    records = [json.loads(l) for l in content]
    step_records = [r for r in records if r.get("record_type") == "step"]

    assert len(step_records) == 1
    assert step_records[0]["has_side_effect"] is True


def test_fuze_toml_overrides_defaults(tmp_path):
    """Config from fuze.toml overrides built-in defaults."""
    toml_path = tmp_path / "fuze.toml"
    toml_path.write_text(
        "[defaults]\nmax_retries = 7\ntimeout = 99000\n",
        encoding="utf-8",
    )

    config = ConfigLoader.load(str(toml_path))
    resolved = ConfigLoader.merge(config, {})

    assert resolved["max_retries"] == 7
    assert resolved["timeout"] == 99000
    assert resolved["max_iterations"] == 25  # default unchanged


def test_guard_options_override_fuze_toml():
    """Guard options override fuze.toml config."""
    project_config = {"defaults": {"max_retries": 10, "timeout": 60000}}

    resolved = ConfigLoader.merge(project_config, {"max_retries": 1, "timeout": 1000})

    assert resolved["max_retries"] == 1
    assert resolved["timeout"] == 1000


def test_langgraph_adapter_preserves_metadata_and_fires_guard():
    """LangGraph adapter preserves function metadata and fires guard logic."""
    from fuze_ai import configure
    configure({"loop_detection": {"repeat_threshold": 100, "window_size": 100}})

    @fuze_tool(max_iterations=2)
    def search_tool(query: str) -> list:
        """Search for results."""
        return [query]

    assert search_tool.__name__ == "search_tool"
    assert search_tool.__doc__ == "Search for results."

    search_tool("q1")
    search_tool("q2")

    with pytest.raises(LoopDetected):
        search_tool("q3")


def test_raw_dispatch_wraps_all_functions():
    """Raw dispatch adapter wraps all functions in a dict."""
    def fn_a(x):
        return x + 1

    def fn_b(x):
        return x + 2

    def fn_c(x):
        return x + 3

    tools = {"a": fn_a, "b": fn_b, "c": fn_c}
    protected = fuze_dispatch(tools)

    assert len(protected) == 3
    assert protected["a"](1) == 2
    assert protected["b"](1) == 3
    assert protected["c"](1) == 4


def test_configure_deep_merges_with_fuze_toml_defaults(tmp_path, monkeypatch):
    """configure() should override only provided fields and keep other fuze.toml defaults."""
    toml_path = tmp_path / "fuze.toml"
    toml_path.write_text(
        "[defaults]\nmax_iterations = 2\ntimeout = 5000\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(tmp_path)

    reset_config()
    configure({"defaults": {"timeout": 20}})

    run = create_run()

    @run.guard
    def step(n: int) -> int:
        return n

    step(1)
    step(2)
    with pytest.raises(LoopDetected):
        step(3)

    timeout_run = create_run()

    @timeout_run.guard
    def slow() -> None:
        time.sleep(0.2)

    with pytest.raises(GuardTimeout):
        slow()


@pytest.mark.asyncio
async def test_concurrent_async_guard_calls_keep_unique_step_numbers(trace_file):
    configure({"defaults": {"trace_output": trace_file}})

    run = create_run({"agent_id": "parallel-step-test"})

    @run.guard
    async def do_work(delay: float) -> float:
        await asyncio.sleep(delay)
        return delay

    await asyncio.gather(
        do_work(0.03),
        do_work(0.01),
        do_work(0.02),
    )
    run.end()

    records = [json.loads(line) for line in Path(trace_file).read_text().strip().split("\n")]
    step_numbers = [r["step_number"] for r in records if r.get("record_type") == "step"]
    assert sorted(step_numbers) == [1, 2, 3]
