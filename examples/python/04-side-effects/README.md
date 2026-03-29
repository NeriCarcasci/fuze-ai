# Example 04 -- Side Effects and Compensation

Shows how Fuze AI tracks side effects and provides automatic compensation (rollback) when a later step fails.

## What it demonstrates

- `@guard(side_effect=True, compensate=cancel_fn)` to mark a function as having real-world side effects and to register a compensation handler
- A two-step workflow: create an invoice, then send a confirmation email
- When the email step fails, the compensation function is invoked to cancel the invoice
- Safe rollback of external state changes

## How to run

```bash
pip install fuze-ai
python main.py
```

## Expected output

```
Fuze AI -- Side Effects Example

Step 1: Creating invoice...
  [side-effect] Invoice INV-ACME-001 created for $499.99
  Invoice ID: INV-ACME-001

Step 2: Sending confirmation email...
  [error] SMTP connection refused: unable to send to billing@acme.example.com

Step 2 failed. Fuze will compensate the side effect...
  [compensate] Cancelling invoice INV-ACME-001...
  [compensate] Invoice INV-ACME-001 cancelled.

Done. The invoice was created and then rolled back.
Check ./fuze-traces.jsonl for the compensation trace.
```

## Why this matters

AI agents that call external APIs (payment processors, databases, email services) can leave behind partial state when something fails mid-workflow. Fuze's compensation mechanism ensures those side effects are rolled back cleanly, similar to a saga pattern in distributed systems.
