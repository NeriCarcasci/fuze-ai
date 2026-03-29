"""
Fuze AI -- Example 02: Budget Ceiling

Demonstrates per-run budget limits and per-call cost caps.
A $1.00 session budget is configured globally, and each call is
individually capped at $0.30. The loop runs 5 iterations, so the
budget is exceeded on iteration 4 (4 x $0.30 = $1.20 > $1.00).
"""

import asyncio
from fuze_ai import configure, guard, BudgetExceeded


# Set a $1.00 budget ceiling for the entire run.
configure({
    "defaults": {
        "max_cost_per_run": 1.00,
    },
})


@guard(max_cost=0.30)
async def call_llm(prompt: str) -> str:
    """Simulate an LLM call that costs ~$0.30 each time."""
    await asyncio.sleep(0.1)
    return f'LLM response for: "{prompt}"'


async def main() -> None:
    print("Fuze AI -- Budget Ceiling Example\n")
    print(f"Session budget : $1.00")
    print(f"Per-call cap   : $0.30\n")

    for i in range(1, 6):
        try:
            result = await call_llm(f"Summarize document {i}")
            print(f"Call {i} OK : {result}")
        except BudgetExceeded as exc:
            print(f"Call {i} BLOCKED : {exc}")
            print("\nBudget enforcement triggered as expected.")
            break

    print("\nDone. Check ./fuze-traces.jsonl for cost details.")


if __name__ == "__main__":
    asyncio.run(main())
