"""
Fuze AI -- Example 05: LangGraph Adapter

Demonstrates the Fuze AI LangGraph adapter, which lets you wrap
LangGraph tool nodes with Fuze runtime safety using the @fuze_tool
decorator. Fuze auto-extracts cost from the OpenAI-shaped usage data
returned by each tool call.
"""

import asyncio
import hashlib

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

@fuze_tool(
    model="openai/gpt-4o",  # pricing table; cost auto-extracted from response usage
)
async def web_search(query: str) -> dict:
    """Search the web. Returns OpenAI-shaped response for auto cost extraction."""
    h = hashlib.sha256(query.encode()).hexdigest()[:8]
    return {
        "result": f'[web_search] Top result for "{query}": https://example.com/{h}',
        "usage": {"prompt_tokens": 1000, "completion_tokens": 500},
        "model": "gpt-4o",
    }


@fuze_tool(side_effect=True)
async def send_slack_message(channel: str, text: str) -> str:
    """Post a message to Slack. Marked as a side effect."""
    return f"[send_slack_message] Sent to #{channel}: {text}"


@fuze_tool(
    model="openai/gpt-4o",  # pricing table; cost auto-extracted from response usage
)
async def summarize_text(text: str) -> dict:
    """Summarize a block of text. Returns OpenAI-shaped response for auto cost extraction."""
    words = text.split()
    short = " ".join(words[:10]) + ("..." if len(words) > 10 else "")
    return {
        "result": f"[summarize_text] Summary: {short}",
        "usage": {"prompt_tokens": 2000, "completion_tokens": 300},
        "model": "gpt-4o",
    }


# -- Simulate a LangGraph-style agent loop ----------------------------------

async def main() -> None:
    print("Fuze AI -- LangGraph Adapter Example\n")

    # Step 1: Search
    print("Step 1: Web search")
    search_response = await web_search("Fuze AI runtime safety middleware")
    print(f"  {search_response['result']}\n")

    # Step 2: Summarize
    print("Step 2: Summarize search result")
    summary_response = await summarize_text(search_response['result'])
    print(f"  {summary_response['result']}\n")

    # Step 3: Send Slack notification (side effect)
    print("Step 3: Notify team via Slack")
    notification = await send_slack_message(
        "ai-agents",
        "Research complete -- see summary in the thread.",
    )
    print(f"  {notification}\n")

    print("All steps completed with Fuze protection.")
    print("Check ./fuze-traces.jsonl for the full trace.")


if __name__ == "__main__":
    asyncio.run(main())
