# Example 03 - Loop Detection

Demonstrates how Fuze AI detects and kills infinite loops caused by an agent repeatedly calling the same function with identical arguments.

## What it demonstrates

- Using `configure()` to set loop detection parameters (`windowSize`, `repeatThreshold`)
- Setting `onLoop: 'kill'` so Fuze throws immediately instead of just logging a warning
- Catching `LoopDetected` errors and inspecting the signal type and details
- How Fuze prevents runaway agent loops before they waste compute and money

## How it works

The example calls `fetchWeather("Paris")` in a loop 10 times. Because the arguments are identical every time, Fuze's loop detector sees the same `argsHash` appearing repeatedly in its sliding window. Once the repeat count hits the `repeatThreshold` (3 identical calls within a window of 5), Fuze fires a `repeated_tool` signal and -- because `onLoop` is set to `'kill'` -- throws a `LoopDetected` error.

The first 2 calls succeed. The 3rd call (the one that hits the threshold) is killed.

## How to run

```bash
npm install
npm start
```

## Expected output

```
Fuze AI -- Loop Detection Example

Config: windowSize=5, repeatThreshold=3, onLoop=kill
Calling fetchWeather("Paris") repeatedly...

Call 1 OK: Weather in Paris: 22C, sunny
Call 2 OK: Weather in Paris: 22C, sunny
Call 3 KILLED: LoopDetected: step 'fetchWeather' repeated identical call 3 times in window of 5
  signal type: repeated_tool
  details    : { count: 3, windowSize: 5, toolName: 'fetchWeather', argsHash: '...' }

Loop detection halted the agent before it could waste more resources.
```

## What to look for in the trace

- The first 2 steps complete normally with no `error` field
- The 3rd step has an `error` field containing `"LoopDetected"` and a corresponding guard event of type `loop_detected`
- The `argsHash` is identical across all three steps, confirming the loop detector correctly identified repeated calls
- No steps beyond the 3rd are recorded -- the agent was stopped immediately
