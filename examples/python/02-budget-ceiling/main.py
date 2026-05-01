"""
Fuze AI — Example 02: Budget Ceiling

Configure a per-run token ceiling, then make repeated guarded calls.
Once the cumulative input + output token count crosses the ceiling,
the next call raises ResourceLimitExceeded.
"""

import asyncio

from fuze_ai import configure, guard, ResourceLimitExceeded


configure({
    "resource_limits": {"max_tokens_per_run": 100_000},
})


@guard
async def analyse(chunk: str) -> dict:
    return {
        "result": f'analysed "{chunk}"',
        "usage": {"prompt_tokens": 40_000, "completion_tokens": 18_000},
        "model": "gpt-4o",
    }


async def main() -> None:
    print("Fuze AI — Budget Ceiling\n")
    print("  ceiling : 100,000 tokens (input + output combined)")
    print("  per call: ~58,000 tokens (auto-extracted from usage)\n")

    chunks = ["report", "feedback", "incidents", "roadmap", "audit"]

    for i, chunk in enumerate(chunks, 1):
        try:
            r = await analyse(chunk)
            print(f"  step {i}: ok — {r['result']}")
        except ResourceLimitExceeded as exc:
            print(f"  step {i}: BLOCKED — {exc}")
            print(f"    observed: {exc.details['observed']} / {exc.details['ceiling']}")
            break

    print("\nTrace: ./fuze-traces.jsonl")


if __name__ == "__main__":
    asyncio.run(main())
