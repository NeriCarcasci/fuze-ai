# Example 03 -- Loop Detection

Shows how Fuze AI detects and halts repetitive tool calls that signal an agent stuck in a loop.

## What it demonstrates

- `configure()` to set `loop_detection.repeat_threshold` to 3
- Calling the same guarded function with identical arguments repeatedly
- Catching `LoopDetected` when the threshold is exceeded
- The first 3 identical calls succeed; the 4th is blocked

## How to run

```bash
pip install fuze-ai
python main.py
```

## Expected output

```
Fuze AI -- Loop Detection Example

repeat_threshold = 3
Calling fetch_weather('Paris') in a loop...

Call 1 OK : Weather for Paris: 22C, partly cloudy
Call 2 OK : Weather for Paris: 22C, partly cloudy
Call 3 OK : Weather for Paris: 22C, partly cloudy
Call 4 BLOCKED : Loop detected: fetch_weather called 4 times with identical arguments (threshold: 3)

Loop detection triggered as expected.

Done. Check ./fuze-traces.jsonl for the loop trace.
```

## How it works

Fuze tracks each `(function_name, args_hash)` pair. When the count for any pair exceeds `repeat_threshold`, the next call raises `LoopDetected` instead of executing. This prevents runaway agents from burning tokens on the same failing or no-op action.

Note: calls with *different* arguments reset the counter, so legitimate pagination or iteration is not affected.
