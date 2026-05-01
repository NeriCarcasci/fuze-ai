# Example 03 — Loop Detection

When an agent calls the same tool with the same arguments over and over, Fuze fires a `repeated_tool` signal and throws `LoopDetected`.

## How it works

`configure()` sets `loopDetection: { windowSize: 5, repeatThreshold: 3 }` and `defaults.onLoop: 'kill'`. The loop detector tracks the `argsHash` of recent calls in a sliding window. Once the same hash appears `repeatThreshold` times within `windowSize`, Fuze throws `LoopDetected` instead of running the next call.

Different cities pass freely. Repeated calls with `'Paris'` trip the detector at the third repeat.

## Run

```bash
npm install
npm start
```

## What to look for in the trace

- The first calls complete normally with no `error` field.
- The blocked step has a `guard_event` of type `loop_detected` with the matching `argsHash`.
- No steps beyond the threshold are recorded.
