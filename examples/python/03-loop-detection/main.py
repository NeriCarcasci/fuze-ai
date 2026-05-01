"""
Fuze AI — Example 03: Loop Detection

When the same function is called with identical arguments more than
`repeat_threshold` times within a sliding window, Fuze raises LoopDetected.
"""

import asyncio

from fuze_ai import configure, guard, LoopDetected


configure({
    "defaults": {"on_loop": "kill"},
    "loop_detection": {"window_size": 5, "repeat_threshold": 3},
})


@guard
async def fetch_weather(city: str) -> dict:
    return {
        "result": f"{city}: 21C, partly cloudy",
        "usage": {"prompt_tokens": 200, "completion_tokens": 30},
        "model": "gpt-4o",
    }


async def main() -> None:
    print("Fuze AI — Loop Detection\n")
    print("  window_size: 5, repeat_threshold: 3, on_loop: kill\n")

    print("Different cities — no loop:")
    for city in ["Paris", "London", "Tokyo"]:
        r = await fetch_weather(city)
        print(f"  {r['result']}")

    print("\nSame city repeated — triggers loop:")
    for i in range(1, 7):
        try:
            r = await fetch_weather("Paris")
            print(f"  retry {i}: ok — {r['result']}")
        except LoopDetected as exc:
            print(f"  retry {i}: BLOCKED — {exc}")
            print(f"    signal: {exc.signal['type']}")
            break

    print("\nTrace: ./fuze-traces.jsonl")


if __name__ == "__main__":
    asyncio.run(main())
