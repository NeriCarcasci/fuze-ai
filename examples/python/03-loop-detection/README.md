# Example 03 — Loop Detection

When an agent calls the same tool with the same arguments over and over, Fuze fires a `repeated_tool` signal and raises `LoopDetected`.

## How it works

`configure()` sets `loop_detection: {window_size: 5, repeat_threshold: 3}` and `defaults.on_loop: 'kill'`. The loop detector tracks the `args_hash` of recent calls in a sliding window. Once the same hash appears `repeat_threshold` times within `window_size`, Fuze raises `LoopDetected` instead of running the next call.

Different cities pass freely. Repeated calls with `'Paris'` trip the detector at the third repeat.

## Run

```bash
pip install fuze-ai
python main.py
```

## What to look for in the trace

- The first calls complete normally with no `error` field.
- The blocked step has a `guard_event` of type `loop_detected` with the matching `args_hash`.
- No steps beyond the threshold are recorded.
