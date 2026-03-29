"""
Fuze AI -- Example 03: Loop Detection

Demonstrates automatic loop detection. When the same function is
called with identical arguments more than `repeat_threshold` times,
Fuze raises LoopDetected to prevent infinite-loop burn.
"""

import asyncio
from fuze_ai import configure, guard, LoopDetected


# A repeat_threshold of 3 means the 4th identical call is blocked.
configure({
    "loop_detection": {
        "repeat_threshold": 3,
    },
})


@guard
async def fetch_weather(city: str) -> str:
    """Simulate a weather API call."""
    await asyncio.sleep(0.1)
    return f"Weather for {city}: 22C, partly cloudy"


async def main() -> None:
    print("Fuze AI -- Loop Detection Example\n")
    print("repeat_threshold = 3")
    print("Calling fetch_weather('Paris') in a loop...\n")

    for i in range(1, 7):
        try:
            result = await fetch_weather("Paris")
            print(f"Call {i} OK : {result}")
        except LoopDetected as exc:
            print(f"Call {i} BLOCKED : {exc}")
            print("\nLoop detection triggered as expected.")
            break

    print("\nDone. Check ./fuze-traces.jsonl for the loop trace.")


if __name__ == "__main__":
    asyncio.run(main())
