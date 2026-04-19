"""
Fuze AI -- Example 02: Token Ceiling

Demonstrates per-run token limits. Each call returns an OpenAI-shaped
response; Fuze auto-extracts tokensIn/tokensOut from the usage payload.
Run ceiling is 100,000 tokens; calls are blocked once the ceiling is crossed.
"""

import asyncio
import hashlib

from fuze_ai import configure, guard, ResourceLimitExceeded


# 100,000-token run ceiling.
configure({
    "resource_limits": {
        "max_tokens_per_run": 100_000,
    },
})


@guard()
async def analyse_chunk(chunk: str) -> dict:
    """Analyse a text chunk. Returns OpenAI-shaped response for auto token extraction."""
    h = hashlib.sha256(chunk.encode()).hexdigest()
    return {
        "result": f'Chunk "{chunk}" analysed: sha256={h[:16]}...',
        "usage": {"prompt_tokens": 40_000, "completion_tokens": 18_000},
        "model": "gpt-4o",
    }


async def main() -> None:
    print("Fuze AI -- Token Ceiling Example\n")
    print("Run ceiling : 100,000 tokens (input + output combined)")
    print("Per call    : ~58,000 tokens (auto-extracted from response.usage)\n")

    chunks = ["quarterly-report", "customer-feedback", "incident-log", "roadmap-draft", "compliance-audit"]

    for i, chunk in enumerate(chunks, 1):
        try:
            response = await analyse_chunk(chunk)
            print(f"Call {i} OK      : {response['result']}")
        except ResourceLimitExceeded as exc:
            print(f"Call {i} BLOCKED : {exc}")
            print(f"  limit    : {exc.details['limit']}")
            print(f"  observed : {exc.details['observed']}")
            print(f"  ceiling  : {exc.details['ceiling']}")
            print("\nResource-limit enforcement prevented runaway token usage.")
            break

    print("\nDone. Check ./fuze-traces.jsonl for per-step token usage.")


if __name__ == "__main__":
    asyncio.run(main())
