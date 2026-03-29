# Example 02 -- Budget Ceiling

Shows how Fuze AI enforces per-run budget limits and per-call cost caps.

## What it demonstrates

- `configure()` to set a session-wide `max_cost_per_run` of $1.00
- `@guard(max_cost=0.30)` to declare that each call costs up to $0.30
- Catching `BudgetExceeded` when cumulative cost exceeds the session budget
- The loop attempts 5 calls (5 x $0.30 = $1.50), but Fuze blocks the 4th call because the cumulative cost ($0.90 after 3 calls) plus the next call's max cost ($0.30) would exceed the $1.00 ceiling

## How to run

```bash
pip install fuze-ai
python main.py
```

## Expected output

```
Fuze AI -- Budget Ceiling Example

Session budget : $1.00
Per-call cap   : $0.30

Call 1 OK : LLM response for: "Summarize document 1"
Call 2 OK : LLM response for: "Summarize document 2"
Call 3 OK : LLM response for: "Summarize document 3"
Call 4 BLOCKED : Budget exceeded: $0.90 spent + $0.30 requested > $1.00 limit

Budget enforcement triggered as expected.

Done. Check ./fuze-traces.jsonl for cost details.
```

## Key takeaway

Budget enforcement is predictive -- Fuze blocks a call *before* it runs if the cost would breach the ceiling, rather than allowing the overage and reporting it after the fact.
