#!/usr/bin/env python
from __future__ import annotations

import asyncio
import json
import sys
import tempfile
from pathlib import Path

from fuze_ai import configure, reset_config, run, span, traced


async def amain() -> int:
    scenario_path = Path(sys.argv[1])
    scenario = json.loads(scenario_path.read_text(encoding="utf-8"))

    workdir = Path(tempfile.mkdtemp(prefix="fuze-parity-py-"))
    trace_path = workdir / "trace.jsonl"

    reset_config()
    configure({"defaults": {"trace_output": str(trace_path)}})

    async with run(agent_id=scenario["name"]):
        for entry in scenario["spans"]:
            kind = entry["kind"]
            if kind == "span":
                await span(
                    role=entry["role"],
                    capture=entry.get("capture", "hash"),
                    content=entry.get("content"),
                    attrs=entry.get("attrs"),
                    tool_name=entry.get("tool_name"),
                )
            elif kind == "traced":
                def make_fn(tool_name: str):
                    def fn(*args):
                        return {"called": tool_name, "args": list(args)}
                    fn.__name__ = tool_name
                    return fn

                wrapped = traced(
                    make_fn(entry["tool_name"]),
                    role=entry["role"],
                    capture=entry.get("capture", "hash"),
                    tool_name=entry["tool_name"],
                )
                wrapped(*entry.get("args", []))

    for raw in trace_path.read_text(encoding="utf-8").splitlines():
        if raw.strip():
            sys.stdout.write(raw + "\n")

    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(amain()))
