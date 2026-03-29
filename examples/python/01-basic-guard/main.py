"""
Fuze AI -- Example 01: Basic Guard

Wraps a plain async function with the @guard decorator and calls it
three times with different arguments.
"""

import asyncio
from fuze_ai import guard


@guard
async def search_documents(query: str) -> list[str]:
    """Simulate a document search with a short delay."""
    await asyncio.sleep(0.2)
    return [
        f'Result for "{query}": Document about AI safety',
        f'Result for "{query}": EU AI Act overview',
    ]


async def main() -> None:
    print("Fuze AI -- Basic Guard Example\n")

    r1 = await search_documents("AI agent safety")
    print("Search 1:", r1)

    r2 = await search_documents("budget enforcement")
    print("Search 2:", r2)

    r3 = await search_documents("loop detection")
    print("Search 3:", r3)

    print("\nAll 3 calls completed.")
    print("Check ./fuze-traces.jsonl for the full trace.")


if __name__ == "__main__":
    asyncio.run(main())
