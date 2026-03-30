"""
Fuze AI -- Example 01: Basic Guard

Wraps a plain async function with the @guard decorator and calls it
three times with different arguments. Uses real file hashing.
"""

import asyncio
import hashlib
from pathlib import Path

from fuze_ai import guard


@guard
async def search_documents(query: str) -> list[dict[str, str]]:
    """Search Python source files in the fuze_ai package for a query term."""
    # Search the TS core source (3 dirs up from examples/python/01-basic-guard -> D:\fuze)
    repo_root = Path(__file__).resolve().parent.parent.parent.parent
    src_dir = repo_root / "packages" / "core" / "src"
    # Also try the Python package if available
    py_src = repo_root.parent / "fuze-python" / "src" / "fuze_ai"
    if py_src.exists():
        src_dir = py_src

    results = []
    for f in sorted(src_dir.glob("*.py" if src_dir.name == "fuze_ai" else "*.ts")):
        content = f.read_text(encoding="utf-8", errors="replace")
        if query.lower() in content.lower():
            h = hashlib.sha256(content.encode()).hexdigest()[:12]
            results.append({"file": f.name, "lines": str(content.count("\n") + 1), "hash": h})
    return results[:5]


async def main() -> None:
    print("Fuze AI -- Basic Guard Example\n")
    print("Searching source files with @guard protection...\n")

    r1 = await search_documents("budget")
    print("Search 'budget':", r1)

    r2 = await search_documents("loop")
    print("Search 'loop'  :", r2)

    r3 = await search_documents("guard")
    print("Search 'guard' :", r3)

    print("\nAll 3 guarded calls completed.")
    print("Check ./fuze-traces.jsonl for the full trace.")


if __name__ == "__main__":
    asyncio.run(main())
