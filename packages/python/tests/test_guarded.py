"""Tests for the @guarded class decorator."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from fuze_ai import configure, guarded


@pytest.fixture
def trace_file(tmp_path) -> str:
    return str(tmp_path / "guarded-trace.jsonl")


def _read_records(trace_file: str) -> list[dict]:
    path = Path(trace_file)
    if not path.exists():
        return []
    text = path.read_text().strip()
    if not text:
        return []
    return [json.loads(line) for line in text.split("\n")]


@pytest.mark.asyncio
async def test_bare_guarded_async_method_creates_run_and_records_step(trace_file):
    configure({"defaults": {"trace_output": trace_file}})

    @guarded
    class Agent:
        async def search(self, query: str) -> str:
            return f"hit:{query}"

    agent = Agent()
    result = await agent.search("hello")
    assert result == "hit:hello"

    records = _read_records(trace_file)
    types = [r["record_type"] for r in records]
    assert types[0] == "run_start"
    assert types[-1] == "run_end"
    steps = [r for r in records if r["record_type"] == "step"]
    assert len(steps) == 1
    assert steps[0]["tool_name"] == "search"


def test_guarded_factory_form_propagates_options(trace_file):
    configure({"defaults": {"trace_output": trace_file}})

    @guarded(timeout=5000, on_loop="warn")
    class Agent:
        def echo(self, value: int) -> int:
            return value

    agent = Agent()
    assert agent.echo(7) == 7

    records = _read_records(trace_file)
    run_starts = [r for r in records if r["record_type"] == "run_start"]
    assert len(run_starts) == 1
    config = run_starts[0]["config"]
    assert config["timeout"] == 5000
    assert config["on_loop"] == "warn"


@pytest.mark.asyncio
async def test_internal_self_calls_record_as_steps_in_same_run(trace_file):
    configure({"defaults": {"trace_output": trace_file}})

    @guarded
    class Agent:
        async def outer(self) -> str:
            inner_result = await self.inner()
            return f"outer:{inner_result}"

        async def inner(self) -> str:
            return "inner-value"

    agent = Agent()
    result = await agent.outer()
    assert result == "outer:inner-value"

    records = _read_records(trace_file)
    run_starts = [r for r in records if r["record_type"] == "run_start"]
    run_ends = [r for r in records if r["record_type"] == "run_end"]
    steps = [r for r in records if r["record_type"] == "step"]

    assert len(run_starts) == 1
    assert len(run_ends) == 1
    assert len(steps) == 2
    run_id = run_starts[0]["run_id"]
    assert all(s["run_id"] == run_id for s in steps)
    tool_names = sorted(s["tool_name"] for s in steps)
    assert tool_names == ["inner", "outer"]


@pytest.mark.asyncio
async def test_two_instances_do_not_share_runs(trace_file):
    configure({"defaults": {"trace_output": trace_file}})

    @guarded
    class Agent:
        async def call(self, x: int) -> int:
            return x + 1

    a = Agent()
    b = Agent()
    await a.call(1)
    await b.call(2)

    records = _read_records(trace_file)
    run_starts = [r for r in records if r["record_type"] == "run_start"]
    assert len(run_starts) == 2
    assert run_starts[0]["run_id"] != run_starts[1]["run_id"]


def test_sync_method_returns_value_not_coroutine(trace_file):
    configure({"defaults": {"trace_output": trace_file}})

    @guarded
    class Calc:
        def add(self, a: int, b: int) -> int:
            return a + b

    calc = Calc()
    result = calc.add(2, 3)
    assert result == 5
    assert not hasattr(result, "__await__")


def test_double_application_is_idempotent(trace_file):
    configure({"defaults": {"trace_output": trace_file}})

    @guarded
    class Agent:
        def step(self) -> str:
            return "done"

    first_step = Agent.step

    Agent2 = guarded(Agent)
    assert Agent2 is Agent
    assert Agent.step is first_step

    Agent3 = guarded(timeout=1000)(Agent)
    assert Agent3 is Agent
    assert Agent.step is first_step


def test_static_and_class_methods_are_not_wrapped(trace_file):
    configure({"defaults": {"trace_output": trace_file}})

    @guarded
    class Agent:
        @staticmethod
        def util() -> str:
            return "static"

        @classmethod
        def factory(cls) -> str:
            return "class"

        def regular(self) -> str:
            return "regular"

    assert Agent.util() == "static"
    assert Agent.factory() == "class"

    records_before = _read_records(trace_file)
    steps_before = [r for r in records_before if r["record_type"] == "step"]
    assert len(steps_before) == 0

    agent = Agent()
    assert agent.regular() == "regular"

    records_after = _read_records(trace_file)
    steps_after = [r for r in records_after if r["record_type"] == "step"]
    assert len(steps_after) == 1
    assert steps_after[0]["tool_name"] == "regular"
