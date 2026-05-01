# Example 04 — Side Effects & Compensation

Mark a step that touches the outside world with `side_effect=True` and register a `compensate` handler. If a later step fails, the compensation rolls the side-effect back.

## How it works

`@guard(side_effect=True, compensate=cancel_invoice)` tells Fuze:
- This step has real-world consequences (don't blindly retry it).
- If the run needs to roll back, call `cancel_invoice` with this step's return value.

In this example the receipt step fails. In a daemon-backed pipeline the rollback fires automatically when the run ends in failure; here we trigger it manually for clarity.

## Run

```bash
pip install fuze-ai
python main.py
```

## What to look for in the trace

- The `create_invoice` step has `has_side_effect: true`.
- The `send_receipt` step has an `error` field.
- A `compensation` record (in daemon-backed traces) shows the rollback succeeded.
