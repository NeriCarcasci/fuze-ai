#!/usr/bin/env python
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

from fuze_ai import configure, create_run, reset_config


def main() -> int:
    scenario_path = Path(sys.argv[1])
    scenario = json.loads(scenario_path.read_text(encoding="utf-8"))

    workdir = Path(tempfile.mkdtemp(prefix="fuze-parity-py-"))
    trace_path = workdir / "trace.jsonl"

    reset_config()
    configure({"defaults": {"trace_output": str(trace_path)}})

    run = create_run({
        "agent_id": scenario["name"],
        "on_loop": "warn",
    })

    for step in scenario["steps"]:
        tokens_in = step["tokensIn"]
        tokens_out = step["tokensOut"]

        def make_echo(ti: int, to: int, name: str):
            def echo(*args):
                return {
                    "content": " ".join(str(a) for a in args),
                    "usage": {"prompt_tokens": ti, "completion_tokens": to},
                }
            echo.__name__ = name
            return echo

        fn = make_echo(tokens_in, tokens_out, step["tool"])
        guarded = run.guard(fn)
        guarded(*step["args"])

    run.end("completed")

    for raw in trace_path.read_text(encoding="utf-8").splitlines():
        if raw.strip():
            sys.stdout.write(raw + "\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())
