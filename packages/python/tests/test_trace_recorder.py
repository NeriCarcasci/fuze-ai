"""Tests for TraceRecorder."""
from __future__ import annotations

import json
import os
import re
import uuid
from pathlib import Path

import pytest
from fuze_ai.trace_recorder import TraceRecorder, verify_chain
from fuze_ai.types import GuardEventRecord, StepRecord


@pytest.fixture
def tmp_trace_file(tmp_path) -> str:
    return str(tmp_path / "test-trace.jsonl")


def _make_step(run_id: str, n: int) -> StepRecord:
    return StepRecord(
        step_id=str(uuid.uuid4()),
        run_id=run_id,
        step_number=n,
        started_at="2026-01-01T00:00:00.000Z",
        ended_at="2026-01-01T00:00:00.100Z",
        tool_name=f"tool-{n}",
        args_hash="abc123",
        has_side_effect=False,
        tokens_in=100,
        tokens_out=50,
        latency_ms=100,
        error=None,
    )


def test_five_step_run_produces_seven_lines(tmp_trace_file):
    """1 run_start + 5 steps + 1 run_end = 7 lines."""
    recorder = TraceRecorder(tmp_trace_file)
    run_id = str(uuid.uuid4())

    recorder.start_run(run_id, "test-agent", {"timeout": 30000})
    for i in range(1, 6):
        recorder.record_step(_make_step(run_id, i))
    recorder.end_run(run_id, "completed")
    recorder.flush()

    lines = Path(tmp_trace_file).read_text().strip().split("\n")
    assert len(lines) == 7


def test_each_line_is_valid_json(tmp_trace_file):
    """Each JSONL line must be parseable."""
    recorder = TraceRecorder(tmp_trace_file)
    run_id = str(uuid.uuid4())

    recorder.start_run(run_id, "test-agent", {})
    recorder.record_step(_make_step(run_id, 1))
    recorder.end_run(run_id, "completed")
    recorder.flush()

    for line in Path(tmp_trace_file).read_text().strip().split("\n"):
        json.loads(line)  # must not raise


def test_timestamps_are_iso8601(tmp_trace_file):
    """Timestamps must be valid ISO 8601."""
    recorder = TraceRecorder(tmp_trace_file)
    run_id = str(uuid.uuid4())

    recorder.start_run(run_id, "test", {})
    recorder.end_run(run_id, "completed")
    recorder.flush()

    iso_re = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}")

    for line in Path(tmp_trace_file).read_text().strip().split("\n"):
        parsed = json.loads(line)
        if "timestamp" in parsed:
            assert iso_re.match(parsed["timestamp"]), f"Bad timestamp: {parsed['timestamp']}"


def test_flush_writes_all_buffered_records(tmp_trace_file):
    """flush() writes all buffered records to disk."""
    recorder = TraceRecorder(tmp_trace_file)

    recorder.start_run("r1", "agent", {})
    assert recorder.pending_count == 1

    recorder.flush()

    assert recorder.pending_count == 0
    assert Path(tmp_trace_file).exists()


def test_guard_events_interleaved_correctly(tmp_trace_file):
    """Guard events appear at the correct position in the trace."""
    recorder = TraceRecorder(tmp_trace_file)
    run_id = str(uuid.uuid4())

    recorder.start_run(run_id, "agent", {})
    recorder.record_step(_make_step(run_id, 1))
    recorder.record_guard_event(GuardEventRecord(
        event_id=str(uuid.uuid4()),
        run_id=run_id,
        step_id="step-2",
        timestamp="2026-01-01T00:00:01.000Z",
        type="loop_detected",
        severity="critical",
        details={"type": "max_iterations"},
    ))
    recorder.end_run(run_id, "killed")
    recorder.flush()

    lines = Path(tmp_trace_file).read_text().strip().split("\n")
    assert len(lines) == 4

    record_types = [json.loads(l)["record_type"] for l in lines]
    assert record_types == ["run_start", "step", "guard_event", "run_end"]


def test_empty_flush_does_nothing(tmp_trace_file):
    """Flushing an empty buffer does not create the file."""
    recorder = TraceRecorder(tmp_trace_file)
    recorder.flush()
    assert not Path(tmp_trace_file).exists()


def test_hash_chain_creation(tmp_trace_file):
    recorder = TraceRecorder(tmp_trace_file)
    run_id = str(uuid.uuid4())

    recorder.start_run(run_id, "hmac-agent", {"timeout": 30000})
    for i in range(1, 4):
        recorder.record_step(_make_step(run_id, i))
    recorder.end_run(run_id, "completed")
    recorder.flush()

    entries = [json.loads(line) for line in Path(tmp_trace_file).read_text(encoding="utf-8").strip().split("\n")]
    assert len(entries) == 5
    assert entries[0]["prev_hash"] == "0" * 64

    for i, entry in enumerate(entries):
        assert re.match(r"^[a-f0-9]{64}$", entry["hash"])
        assert re.match(r"^[a-f0-9]{64}$", entry["prev_hash"])
        assert re.match(r"^[a-f0-9]{64}$", entry["signature"])
        if i > 0:
            assert entry["prev_hash"] == entries[i - 1]["hash"]


def test_tamper_detection_data(tmp_trace_file):
    recorder = TraceRecorder(tmp_trace_file)
    run_id = str(uuid.uuid4())

    recorder.start_run(run_id, "tamper-agent", {})
    for i in range(1, 9):
        recorder.record_step(_make_step(run_id, i))
    recorder.end_run(run_id, "completed")
    recorder.flush()

    entries = [json.loads(line) for line in Path(tmp_trace_file).read_text(encoding="utf-8").strip().split("\n")]
    entries[5]["tool_name"] = "tampered-tool"
    result = verify_chain(entries)

    assert result["valid"] is False
    assert result["first_invalid_index"] == 5


def test_tamper_detection_hmac_only(tmp_trace_file):
    recorder = TraceRecorder(tmp_trace_file)
    run_id = str(uuid.uuid4())

    recorder.start_run(run_id, "tamper-agent", {})
    for i in range(1, 9):
        recorder.record_step(_make_step(run_id, i))
    recorder.end_run(run_id, "completed")
    recorder.flush()

    entries = [json.loads(line) for line in Path(tmp_trace_file).read_text(encoding="utf-8").strip().split("\n")]
    entries[5]["signature"] = "f" * 64
    result = verify_chain(entries)

    assert result["valid"] is True
    assert result["hmac_valid"] is False
    assert result["first_invalid_index"] == 5


def test_backwards_compatibility_legacy_entries(tmp_trace_file):
    recorder = TraceRecorder(tmp_trace_file)
    run_id = str(uuid.uuid4())

    recorder.start_run(run_id, "legacy-agent", {})
    for i in range(1, 9):
        recorder.record_step(_make_step(run_id, i))
    recorder.end_run(run_id, "completed")
    recorder.flush()

    entries = [json.loads(line) for line in Path(tmp_trace_file).read_text(encoding="utf-8").strip().split("\n")]
    for i in range(5):
        entries[i].pop("hash", None)
        entries[i].pop("prev_hash", None)
        entries[i].pop("signature", None)
        entries[i].pop("sequence", None)

    result = verify_chain(entries)
    assert result == {"valid": True, "hmac_valid": True}


def test_key_file_creation(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    key_path = tmp_path / ".fuze" / "audit.key"
    monkeypatch.setattr("fuze_ai.trace_recorder._audit_key_path", lambda: key_path)

    if key_path.exists():
        key_path.unlink()

    recorder = TraceRecorder(str(tmp_path / "trace.jsonl"))
    recorder.start_run(str(uuid.uuid4()), "key-agent", {})

    assert key_path.exists()
    assert key_path.stat().st_size == 32
    if os.name != "nt":
        assert (key_path.stat().st_mode & 0o777) == 0o600


def test_key_file_reuse(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    key_path = tmp_path / ".fuze" / "audit.key"
    monkeypatch.setattr("fuze_ai.trace_recorder._audit_key_path", lambda: key_path)

    step = StepRecord(
        step_id="same-step",
        run_id="same-run",
        step_number=1,
        started_at="2026-01-01T00:00:00.000Z",
        ended_at="2026-01-01T00:00:00.100Z",
        tool_name="same-tool",
        args_hash="same-args",
        has_side_effect=False,
        tokens_in=100,
        tokens_out=50,
        latency_ms=100,
        error=None,
    )

    recorder_a = TraceRecorder(str(tmp_path / "trace-a.jsonl"))
    recorder_a.record_step(step)
    sig_a = recorder_a.get_buffer()[0]["signature"]

    recorder_b = TraceRecorder(str(tmp_path / "trace-b.jsonl"))
    recorder_b.record_step(step)
    sig_b = recorder_b.get_buffer()[0]["signature"]

    assert sig_a == sig_b
