"""
Fuze AI -- Example 03: Loop Detection

Demonstrates automatic loop detection. When the same function is
called with identical arguments more than `repeat_threshold` times,
Fuze raises LoopDetected to prevent infinite-loop burn.
"""

import asyncio
import hashlib

from fuze_ai import configure, guard, LoopDetected


# repeat_threshold=3: the 3rd identical call in the window is blocked.
configure({
    "loop_detection": {
        "repeat_threshold": 3,
        "window_size": 5,
    },
})


@guard
async def fetch_weather(city: str) -> str:
    """Compute a deterministic 'weather' from the city name."""
    h = hashlib.md5(city.encode()).hexdigest()
    temp = int(h[:2], 16) % 35 + 5
    humidity = int(h[2:4], 16) % 100
    return f"Weather in {city}: {temp}C, humidity {humidity}%"


async def main() -> None:
    print("Fuze AI -- Loop Detection Example\n")
    print("Config: window_size=5, repeat_threshold=3, on_loop=kill\n")

    # Different cities: no loop triggered
    print("--- Different cities (no loop) ---")
    for city in ["Paris", "London", "Tokyo"]:
        result = await fetch_weather(city)
        print(f"  {result}")

    print()

    # Same city repeated: triggers loop detection
    print("--- Same city repeated (triggers loop) ---")
    for i in range(1, 7):
        try:
            result = await fetch_weather("Paris")
            print(f"  Retry {i} OK: {result}")
        except LoopDetected as exc:
            print(f"  Retry {i} BLOCKED: {exc}")
            print("\nLoop detection halted the runaway agent.")
            break

    print("\nDone. Check ./fuze-traces.jsonl for the loop trace.")


if __name__ == "__main__":
    asyncio.run(main())
