from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

import fuze_ai
from fuze_ai.errors import FuzeError
from fuze_ai.types import StepContent


@pytest.fixture
def trace_file(tmp_path) -> Path:
    return tmp_path / "trace.jsonl"


class StubRedactor:
    def redact_content(self, content: StepContent) -> StepContent:
        return _redact_all_strings(content)


_PRESERVE_KEYS = {"kind", "role", "doc_id", "chunk_id"}


def _redact_all_strings(value: Any, preserve: bool = False) -> Any:
    if isinstance(value, str):
        return value if preserve else "***"
    if isinstance(value, dict):
        return {k: _redact_all_strings(v, preserve=(k in _PRESERVE_KEYS)) for k, v in value.items()}
    if isinstance(value, list):
        return [_redact_all_strings(v) for v in value]
    return value


def _read_steps(path: Path) -> list[dict]:
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").strip().split("\n")
        if json.loads(line).get("record_type") == "step"
    ]


async def test_full_redact_runs_through_redactor(trace_file: Path) -> None:
    fuze_ai.configure({
        "defaults": {"trace_output": str(trace_file)},
        "redactor": StubRedactor(),
    })

    async with fuze_ai.run():
        await fuze_ai.span(
            role="user",
            capture="full+redact",
            content={"kind": "text", "text": "my secret email is x@y.com"},
        )

    steps = _read_steps(trace_file)
    assert len(steps) == 1
    content = steps[0]["content"]
    assert content["kind"] == "text"
    assert content["text"] == "***"
    assert "x@y.com" not in json.dumps(steps[0])


async def test_full_redact_without_redactor_raises(trace_file: Path) -> None:
    fuze_ai.configure({"defaults": {"trace_output": str(trace_file)}})

    async with fuze_ai.run():
        with pytest.raises(FuzeError, match="redactor"):
            await fuze_ai.span(
                role="user",
                capture="full+redact",
                content={"kind": "text", "text": "secret"},
            )


async def test_full_capture_does_not_redact(trace_file: Path) -> None:
    fuze_ai.configure({
        "defaults": {"trace_output": str(trace_file)},
        "redactor": StubRedactor(),
    })

    async with fuze_ai.run():
        await fuze_ai.span(
            role="user",
            capture="full",
            content={"kind": "text", "text": "leaks-through"},
        )

    steps = _read_steps(trace_file)
    assert steps[0]["content"]["text"] == "leaks-through"
