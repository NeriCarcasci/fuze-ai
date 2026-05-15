from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

import fuze_ai
from fuze_ai.errors import FuzeError
from fuze_ai.run_context import get_current_run_context


@pytest.fixture
def trace_file(tmp_path) -> Path:
    return tmp_path / "trace.jsonl"


@pytest.fixture(autouse=True)
def _set_trace_output(trace_file):
    fuze_ai.configure({"defaults": {"trace_output": str(trace_file)}})
    yield


def _read_steps(path: Path) -> list[dict]:
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").strip().split("\n")
        if json.loads(line).get("record_type") == "step"
    ]


async def test_span_outside_run_raises() -> None:
    with pytest.raises(FuzeError, match="outside fuze.run"):
        await fuze_ai.span(role="tool")


async def test_traced_outside_run_raises() -> None:
    async def fn() -> int:
        return 1

    wrapped = fuze_ai.traced(fn, role="llm")
    with pytest.raises(FuzeError, match="outside fuze.run"):
        await wrapped()


async def test_context_propagates_across_await(trace_file: Path) -> None:
    async def inner() -> str:
        await asyncio.sleep(0)
        ctx = get_current_run_context()
        assert ctx is not None
        await fuze_ai.span(role="tool", capture="full", content={"kind": "text", "text": "inside"})
        return ctx.run_id

    async with fuze_ai.run() as ctx:
        inner_run_id = await inner()
        assert inner_run_id == ctx.run_id

    steps = _read_steps(trace_file)
    assert len(steps) == 1
    assert steps[0]["run_id"] == inner_run_id


async def test_nested_traced_inherits_parent_step_id(trace_file: Path) -> None:
    async def child() -> int:
        await fuze_ai.span(role="tool", capture="full", content={"kind": "text", "text": "child-span"})
        return 1

    async def parent() -> int:
        return await fuze_ai.traced(child, role="llm")()

    async with fuze_ai.run():
        await fuze_ai.traced(parent, role="assistant")()

    steps = _read_steps(trace_file)
    by_tool = {s["tool_name"]: s for s in steps}
    assert by_tool["parent"].get("parent_step_id") is None or "parent_step_id" not in by_tool["parent"]
    assert by_tool["child"]["parent_step_id"] == by_tool["parent"]["step_id"]
    assert by_tool["tool"]["parent_step_id"] == by_tool["child"]["step_id"]


async def test_run_marks_status_error_on_exception(trace_file: Path) -> None:
    with pytest.raises(RuntimeError):
        async with fuze_ai.run():
            await fuze_ai.span(role="tool")
            raise RuntimeError("boom")

    entries = [
        json.loads(line)
        for line in trace_file.read_text(encoding="utf-8").strip().split("\n")
    ]
    end = next(e for e in entries if e.get("record_type") == "run_end")
    assert end["status"] == "error"
