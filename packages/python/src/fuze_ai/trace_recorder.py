"""Buffered JSONL trace recorder for audit logging."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, TypedDict

from fuze_ai.types import GuardEventRecord, StepRecord

ZERO_HASH = "0" * 64


class VerifyChainResult(TypedDict, total=False):
    valid: bool
    hmac_valid: bool
    first_invalid_index: int


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _audit_key_path() -> Path:
    configured = os.environ.get("FUZE_AUDIT_KEY_PATH")
    if configured:
        return Path(configured)
    return Path.home() / ".fuze" / "audit.key"


def _ensure_audit_key() -> bytes:
    key_path = _audit_key_path()
    key_path.parent.mkdir(parents=True, exist_ok=True)
    if not key_path.exists():
        key_path.write_bytes(secrets.token_bytes(32))
    try:
        os.chmod(key_path, 0o600)
    except OSError:
        pass
    key = key_path.read_bytes()
    if len(key) != 32:
        raise ValueError(f"Invalid audit key length at '{key_path}': expected 32 bytes, got {len(key)}")
    return key


def _canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)


def _compute_hash(entry_without_signature: dict[str, Any]) -> str:
    return hashlib.sha256(_canonical_json(entry_without_signature).encode("utf-8")).hexdigest()


def _entry_id(entry: dict[str, Any]) -> str:
    record_type = entry.get("record_type")
    if record_type == "step":
        return str(entry.get("step_id", ""))
    if record_type == "guard_event":
        return str(entry.get("event_id", ""))
    return str(entry.get("run_id", ""))


def _compute_signature(key: bytes, sequence: int, entry_id: str, entry_hash: str, prev_hash: str) -> str:
    payload = f"{sequence}|{entry_id}|{entry_hash}|{prev_hash}".encode("utf-8")
    return hmac.new(key, payload, hashlib.sha256).hexdigest()


def _is_signed_entry(entry: dict[str, Any]) -> bool:
    return (
        isinstance(entry.get("hash"), str)
        and isinstance(entry.get("prev_hash"), str)
        and isinstance(entry.get("signature"), str)
        and isinstance(entry.get("sequence"), int)
    )


def verify_chain(entries: list[dict[str, Any]]) -> VerifyChainResult:
    if not entries:
        return {"valid": True, "hmac_valid": True}

    key = _ensure_audit_key()
    previous_hash: str | None = None
    inferred_sequence = 0

    for index, entry in enumerate(entries):
        if not _is_signed_entry(entry):
            continue

        expected_prev_hash = previous_hash or str(entry["prev_hash"])
        base = dict(entry)
        base.pop("hash", None)
        base.pop("signature", None)
        expected_hash = _compute_hash(base)
        sequence = int(entry.get("sequence", inferred_sequence))
        expected_signature = _compute_signature(
            key,
            sequence,
            _entry_id(entry),
            expected_hash,
            expected_prev_hash,
        )

        hash_valid = entry["prev_hash"] == expected_prev_hash and entry["hash"] == expected_hash
        hmac_valid = entry["signature"] == expected_signature

        if not hash_valid or not hmac_valid:
            return {
                "valid": hash_valid,
                "hmac_valid": hmac_valid,
                "first_invalid_index": index,
            }

        previous_hash = str(entry["hash"])
        inferred_sequence += 1

    return {"valid": True, "hmac_valid": True}


class TraceRecorder:
    """Writes execution traces as JSONL to a local file.

    Records are buffered in memory and written on flush().

    Args:
        output_path: Path to the JSONL output file. Default: './fuze-traces.jsonl'.
    """

    def __init__(self, output_path: str = "./fuze-traces.jsonl") -> None:
        self._output_path = Path(output_path)
        self._buffer: list[dict[str, Any]] = []
        self._key = _ensure_audit_key()
        self._sequence = 0
        self._last_hash: str | None = None

    def _append_signed_entry(self, entry: dict[str, Any]) -> None:
        prev_hash = self._last_hash or ZERO_HASH
        sequence = self._sequence
        with_chain = {**entry, "prev_hash": prev_hash, "sequence": sequence}
        entry_hash = _compute_hash(with_chain)
        signature = _compute_signature(self._key, sequence, _entry_id(entry), entry_hash, prev_hash)
        signed_entry = {**with_chain, "hash": entry_hash, "signature": signature}

        self._buffer.append(signed_entry)
        self._last_hash = entry_hash
        self._sequence += 1

    def start_run(self, run_id: str, agent_id: str, config: dict[str, Any]) -> None:
        """Record the start of a run.

        Args:
            run_id: Unique run identifier.
            agent_id: Identifier for the agent/caller.
            config: The resolved configuration for this run.
        """
        self._append_signed_entry({
            "record_type": "run_start",
            "run_id": run_id,
            "agent_id": agent_id,
            "config": config,
            "timestamp": _now_iso(),
        })

    def record_step(self, step: StepRecord) -> None:
        """Record a step execution.

        Args:
            step: The step record to log.
        """
        self._append_signed_entry({"record_type": "step", **step})

    def record_guard_event(self, event: GuardEventRecord) -> None:
        """Record a guard event (loop detected, budget exceeded, etc.).

        Args:
            event: The guard event record to log.
        """
        self._append_signed_entry({"record_type": "guard_event", **event})

    def end_run(self, run_id: str, status: str) -> None:
        self._append_signed_entry({
            "record_type": "run_end",
            "run_id": run_id,
            "status": status,
            "timestamp": _now_iso(),
        })

    def flush(self) -> None:
        """Write all buffered records to disk as JSONL (one JSON object per line).

        Clears the buffer after writing.
        """
        if not self._buffer:
            return

        lines = "\n".join(json.dumps(entry) for entry in self._buffer) + "\n"
        self._buffer.clear()

        self._output_path.parent.mkdir(parents=True, exist_ok=True)
        with self._output_path.open("a", encoding="utf-8") as fh:
            fh.write(lines)

    @property
    def pending_count(self) -> int:
        """Number of buffered (unflushed) records."""
        return len(self._buffer)

    def get_buffer(self) -> list[dict[str, Any]]:
        """Return a copy of the buffered entries (for testing)."""
        return list(self._buffer)
