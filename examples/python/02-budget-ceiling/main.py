"""
Fuze AI -- Example 02: Budget Ceiling

Demonstrates per-run budget limits with automatic cost extraction.
Each call returns an OpenAI-shaped response; Fuze reads usage data
and applies gpt-4o pricing automatically.
Run ceiling is $1.00; calls are blocked once the budget is exhausted.
"""

import asyncio
import hashlib

from fuze_ai import configure, guard, BudgetExceeded


# $1.00 run ceiling. Built-in gpt-4o pricing is used automatically.
configure({
    "defaults": {
        "max_cost_per_run": 1.00,
    },
})


@guard(
    max_cost=0.50,           # per-step ceiling ($0.50)
    model="openai/gpt-4o",  # pricing table; cost auto-extracted from response usage
)
async def analyse_chunk(chunk: str) -> dict:
    """Analyse a text chunk. Returns OpenAI-shaped response for auto cost extraction."""
    h = hashlib.sha256(chunk.encode()).hexdigest()
    return {
        "result": f'Chunk "{chunk}" analysed: sha256={h[:16]}...',
        "usage": {"prompt_tokens": 40_000, "completion_tokens": 18_000},
        "model": "gpt-4o",
    }


async def main() -> None:
    print("Fuze AI -- Budget Ceiling Example\n")
    print("Run ceiling    : $1.00")
    print("Step ceiling   : $0.50")
    print("Cost/call      : auto-extracted from response usage (gpt-4o pricing)\n")

    chunks = ["quarterly-report", "customer-feedback", "incident-log", "roadmap-draft", "compliance-audit"]

    for i, chunk in enumerate(chunks, 1):
        try:
            response = await analyse_chunk(chunk)
            print(f"Call {i} OK      : {response['result']}")
        except BudgetExceeded as exc:
            print(f"Call {i} BLOCKED : {exc}")
            print(f"  level    : {exc.level}")
            print(f"  estimated: ${exc.estimated_cost:.4f}")
            print(f"  ceiling  : ${exc.ceiling:.4f}")
            print(f"  spent    : ${exc.spent:.4f}")
            print("\nBudget enforcement prevented runaway spend.")
            break

    print("\nDone. Check ./fuze-traces.jsonl for cost details.")


if __name__ == "__main__":
    asyncio.run(main())
