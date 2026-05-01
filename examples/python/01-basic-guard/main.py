"""
Fuze AI — Example 01: Basic Guard

Wrap an async tool with the `@guard` decorator. Every call is traced;
tokens are auto-extracted from OpenAI-shaped `usage` payloads.
"""

import asyncio

from fuze_ai import guard


@guard
async def classify(text: str) -> dict:
    """Pretend this calls an LLM. The return shape lets Fuze auto-extract tokens."""
    return {
        "result": "long" if len(text) > 50 else "short",
        "usage": {
            "prompt_tokens": max(1, len(text) // 4),
            "completion_tokens": 4,
        },
        "model": "gpt-4o",
    }


async def main() -> None:
    print("Fuze AI — Basic Guard\n")

    samples = [
        "hello",
        "a much longer piece of text that exceeds fifty characters end-to-end",
        "short again",
    ]

    for text in samples:
        r = await classify(text)
        total = r["usage"]["prompt_tokens"] + r["usage"]["completion_tokens"]
        print(f"  {r['result']:<6} — {total:>3} tokens")

    print("\nTrace: ./fuze-traces.jsonl")


if __name__ == "__main__":
    asyncio.run(main())
