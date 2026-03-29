# Example 05 -- LangGraph Adapter

Demonstrates how to use the Fuze AI LangGraph adapter to add runtime safety to LangGraph tool nodes.

## What it demonstrates

- Importing `fuze_tool` from `fuze_ai.adapters.langgraph`
- `@fuze_tool(max_cost=0.10)` to wrap a tool node with a per-call cost cap
- `@fuze_tool(side_effect=True)` to mark a tool node as having real-world side effects
- A simulated three-step agent loop: search, summarize, notify

## How to run

```bash
pip install -r requirements.txt
python main.py
```

## Expected output

```
Fuze AI -- LangGraph Adapter Example

Step 1: Web search
  [web_search] Top result for "Fuze AI runtime safety middleware": https://example.com/result

Step 2: Summarize search result
  [summarize_text] Summary: [web_search] Top result for "Fuze AI runtime safety middleware":...

Step 3: Notify team via Slack
  [send_slack_message] Sent to #ai-agents: Research complete -- see summary in the thread.

All steps completed.
Check ./fuze-traces.jsonl for the full trace.
```

## How `fuze_tool` differs from `guard`

| Feature | `@guard` | `@fuze_tool` |
|---------|----------|--------------|
| Use case | General Python functions | LangGraph tool nodes |
| Integration | Standalone | Registers with the LangGraph tool registry |
| Parameters | Same (`max_cost`, `side_effect`, `compensate`) | Same -- mirrors `@guard` |

The adapter ensures Fuze safety checks (budget, loop detection, side-effect tracking) run inside the LangGraph execution graph, so you get the same protections whether your agent is a simple script or a full LangGraph pipeline.
