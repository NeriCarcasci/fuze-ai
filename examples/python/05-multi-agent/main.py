"""
Fuze AI — Example 05: Multi-Agent Shared Run

`create_run()` opens a run context. Tools wrapped with `run.guard()`
share its loop detector and resource ceiling — different tools, one
budget, one trace.
"""

import asyncio

from fuze_ai import configure, create_run


configure({
    "resource_limits": {"max_tokens_per_run": 50_000},
})


# --- Researcher agent tools ---

async def web_search(query: str) -> dict:
    return {
        "result": [f'hit-1 for "{query}"', f'hit-2 for "{query}"'],
        "usage": {"prompt_tokens": 2_000, "completion_tokens": 500},
        "model": "gpt-4o",
    }


async def summarise(docs: list[str]) -> dict:
    return {
        "result": f"summary of {len(docs)} docs",
        "usage": {"prompt_tokens": 3_000, "completion_tokens": 800},
        "model": "gpt-4o",
    }


# --- Writer agent tools ---

async def draft(summary: str, tone: str) -> dict:
    return {
        "result": f"[draft|{tone}] {summary}",
        "usage": {"prompt_tokens": 4_000, "completion_tokens": 2_000},
        "model": "gpt-4o",
    }


async def edit_draft(text: str) -> dict:
    return {
        "result": text.replace("draft", "final"),
        "usage": {"prompt_tokens": 2_000, "completion_tokens": 1_500},
        "model": "gpt-4o",
    }


async def main() -> None:
    run = create_run({"agent_id": "research-team"})
    print("Fuze AI — Multi-Agent Shared Run")
    print(f"  runId  : {run.run_id}")
    print("  ceiling: 50,000 tokens (shared across all agents)\n")

    search = run.guard(web_search)
    summary = run.guard(summarise)
    drafter = run.guard(draft)
    editor = run.guard(edit_draft)

    print("=== Researcher ===")
    hits = await search("budget enforcement")
    print(f"  search : {len(hits['result'])} hits")
    sum_ = await summary(hits["result"])
    print(f"  summary: {sum_['result']}")

    print("\n=== Writer ===")
    d = await drafter(sum_["result"], "technical")
    print(f"  draft  : {d['result']}")
    e = await editor(d["result"])
    print(f"  final  : {e['result']}")

    status = run.get_status()
    used = status["total_tokens_in"] + status["total_tokens_out"]
    print("\n=== Run Status ===")
    print(f"  steps     : {status['step_count']}")
    print(f"  tokens    : {status['total_tokens_in']} in + {status['total_tokens_out']} out")
    print(f"  remaining : {max(0, 50_000 - used)} tokens")

    run.end()
    print("\nTrace: ./fuze-traces.jsonl")


if __name__ == "__main__":
    asyncio.run(main())
