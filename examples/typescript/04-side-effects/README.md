# Example 04 — Side Effects & Compensation

Mark a step that touches the outside world with `sideEffect: true` and register a `compensate` handler. If a later step fails, the compensation rolls the side-effect back.

## How it works

`guard(createInvoice, { sideEffect: true, compensate: cancelInvoice })` tells Fuze:
- This step has real-world consequences (don't blindly retry it).
- If the run needs to roll back, call `cancelInvoice` with this step's return value.

In this example the receipt step fails. In a daemon-backed pipeline the rollback fires automatically when the run ends in failure; here we trigger it manually for clarity.

## Run

```bash
npm install
npm start
```

## What to look for in the trace

- The `createInvoice` step has `hasSideEffect: true`.
- The `sendReceipt` step has an `error` field.
- A `compensation` record (in daemon-backed traces) shows the rollback succeeded.
