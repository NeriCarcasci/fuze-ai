from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

import fuze_ai


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


async def test_traced_async_function(trace_file: Path) -> None:
    async def call_llm(prompt: str) -> str:
        await asyncio.sleep(0)
        return f"reply: {prompt}"

    async with fuze_ai.run():
        wrapped = fuze_ai.traced(call_llm, role="llm", capture="full")
        result = await wrapped("hi")
        assert result == "reply: hi"

    steps = _read_steps(trace_file)
    assert len(steps) == 1
    step = steps[0]
    assert step["role"] == "llm"
    assert step["tool_name"] == "call_llm"
    assert step["capture"] == "full"
    assert step["content"]["kind"] == "tool_call"
    assert step["content"]["result"] == "reply: hi"
    assert step["latency_ms"] >= 0
    assert "error" not in step


async def test_traced_sync_function(trace_file: Path) -> None:
    def add(a: int, b: int) -> int:
        return a + b

    async with fuze_ai.run():
        wrapped = fuze_ai.traced(add, role="tool", capture="full")
        assert wrapped(2, 3) == 5

    steps = _read_steps(trace_file)
    assert len(steps) == 1
    assert steps[0]["role"] == "tool"
    assert steps[0]["content"]["result"] == 5


async def test_traced_error_records_error_field(trace_file: Path) -> None:
    def boom() -> None:
        raise ValueError("nope")

    with pytest.raises(ValueError, match="nope"):
        async with fuze_ai.run():
            fuze_ai.traced(boom, role="tool")()

    steps = _read_steps(trace_file)
    assert len(steps) == 1
    assert steps[0]["error"] == "nope"
