"""
Fuze AI — Example 04: Side Effects & Compensation

Mark a step that touches the outside world with `side_effect=True` and
register a compensation handler. If a later step fails, the compensation
rolls the side-effect back. (In a daemon-backed pipeline the rollback
fires automatically when the run ends in failure; here we trigger it
manually for clarity.)
"""

import asyncio

from fuze_ai import guard


# Pretend payments service — in-memory only.
invoices: dict[str, dict] = {}


async def cancel_invoice(invoice_id: str) -> None:
    inv = invoices.get(invoice_id)
    if inv is not None:
        inv["status"] = "void"
        print(f"  [compensate]  voided {invoice_id}")


@guard(side_effect=True, compensate=cancel_invoice)
async def create_invoice(customer: str, amount: float) -> str:
    invoice_id = f"inv_{len(invoices) + 1}"
    invoices[invoice_id] = {"customer": customer, "amount": amount, "status": "open"}
    print(f"  [side-effect] created {invoice_id} — {customer} ${amount}")
    return invoice_id


@guard(side_effect=True)
async def send_receipt(invoice_id: str) -> None:
    raise RuntimeError(f"SMTP unreachable (invoice {invoice_id})")


async def main() -> None:
    print("Fuze AI — Side Effects & Compensation\n")

    print("Step 1: create invoice")
    invoice_id = await create_invoice("Acme Corp", 499.99)

    print("\nStep 2: send receipt (fails)")
    try:
        await send_receipt(invoice_id)
    except RuntimeError as exc:
        print(f"  failed: {exc}")

    print("\nStep 3: compensate")
    await cancel_invoice(invoice_id)

    print(f'\nFinal status of {invoice_id}: "{invoices[invoice_id]["status"]}"')
    print("Trace: ./fuze-traces.jsonl")


if __name__ == "__main__":
    asyncio.run(main())
