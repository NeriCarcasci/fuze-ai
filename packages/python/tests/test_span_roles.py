from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

import fuze_ai


@pytest.fixture
def trace_file(tmp_path) -> Path:
    return tmp_path / "trace.jsonl"


@pytest.fixture(autouse=True)
def _set_trace_output(monkeypatch, trace_file):
    fuze_ai.configure({"defaults": {"trace_output": str(trace_file)}})
    yield


def _read_steps(path: Path) -> list[dict[str, Any]]:
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").strip().split("\n")
        if json.loads(line).get("record_type") == "step"
    ]


@pytest.mark.parametrize("role,content", [
    ("user", {"kind": "text", "text": "hi"}),
    ("assistant", {"kind": "text", "text": "hello"}),
    ("system", {"kind": "text", "text": "you are an agent"}),
    ("tool", {"kind": "tool_call", "args": {"x": 1}, "result": 2}),
    ("llm", {"kind": "messages", "messages": [{"role": "user", "text": "hi"}]}),
    ("retrieval", {
        "kind": "retrieval",
        "query": "what is fuze",
        "results": [{"doc_id": "d1", "chunk_id": "c1", "score": 0.9}],
    }),
])
async def test_span_role_roundtrip(role: str, content: dict, trace_file: Path) -> None:
    async with fuze_ai.run(session_id="s1", user_id="u1"):
        await fuze_ai.span(role=role, capture="full", content=content)

    steps = _read_steps(trace_file)
    assert len(steps) == 1
    step = steps[0]
    assert step["role"] == role
    assert step["capture"] == "full"
    assert step["content"] == content


async def test_span_default_capture_is_hash_no_content(trace_file: Path) -> None:
    async with fuze_ai.run():
        await fuze_ai.span(role="tool", content={"kind": "text", "text": "secret"})

    steps = _read_steps(trace_file)
    assert len(steps) == 1
    assert steps[0]["capture"] == "hash"
    assert "content" not in steps[0]


async def test_span_args_hash_stable_for_same_content(trace_file: Path) -> None:
    async with fuze_ai.run():
        await fuze_ai.span(role="user", capture="full", content={"kind": "text", "text": "hi"})
        await fuze_ai.span(role="user", capture="full", content={"kind": "text", "text": "hi"})

    steps = _read_steps(trace_file)
    assert steps[0]["args_hash"] == steps[1]["args_hash"]
