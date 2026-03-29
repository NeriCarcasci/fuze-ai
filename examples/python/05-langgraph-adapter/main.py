"""
Fuze AI -- Example 05: LangGraph Adapter

Demonstrates the Fuze AI LangGraph adapter, which lets you wrap
LangGraph tool nodes with Fuze runtime safety using the @fuze_tool
decorator.
"""

import asyncio
from fuze_ai import configure
from fuze_ai.adapters.langgraph import fuze_tool


# -- Configure Fuze for this session ----------------------------------------

configure({
    "defaults": {
        "max_cost_per_run": 2.00,
    },
    "loop_detection": {
        "repeat_threshold": 5,
    },
})


# -- LangGraph tools wrapped with Fuze --------------------------------------

@fuze_tool(max_cost=0.10)
async def web_search(query: str) -> str:
    """Search the web. Capped at $0.10 per call."""
    await asyncio.sleep(0.15)
    return f'[web_search] Top result for "{query}": https://example.com/result'


@fuze_tool(side_effect=True)
async def send_slack_message(channel: str, text: str) -> str:
    """Post a message to Slack. Marked as a side effect."""
    await asyncio.sleep(0.1)
    return f"[send_slack_message] Sent to #{channel}: {text}"


@fuze_tool(max_cost=0.05)
async def summarize_text(text: str) -> str:
    """Summarize a block of text. Capped at $0.05 per call."""
    await asyncio.sleep(0.1)
    words = text.split()
    short = " ".join(words[:10]) + ("..." if len(words) > 10 else "")
    return f"[summarize_text] Summary: {short}"


# -- Simulate a LangGraph-style agent loop ----------------------------------

async def main() -> None:
    print("Fuze AI -- LangGraph Adapter Example\n")

    # Step 1: Search
    print("Step 1: Web search")
    result = await web_search("Fuze AI runtime safety middleware")
    print(f"  {result}\n")

    # Step 2: Summarize
    print("Step 2: Summarize search result")
    summary = await summarize_text(result)
    print(f"  {summary}\n")

    # Step 3: Send Slack notification (side effect)
    print("Step 3: Notify team via Slack")
    notification = await send_slack_message(
        "ai-agents",
        "Research complete -- see summary in the thread.",
    )
    print(f"  {notification}\n")

    print("All steps completed.")
    print("Check ./fuze-traces.jsonl for the full trace.")


if __name__ == "__main__":
    asyncio.run(main())
