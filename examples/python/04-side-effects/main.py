"""
Fuze AI -- Example 04: Side Effects and Compensation

Demonstrates side-effect tracking with automatic compensation.
Creates a real invoice file on disk, then a follow-up email step
fails. Compensation voids the invoice file.
"""

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path

from fuze_ai import guard

INVOICE_FILE = Path(__file__).parent / "invoice.json"


# -- Compensation function --------------------------------------------------

async def cancel_invoice(invoice_id: str) -> None:
    """Compensate by voiding the invoice file on disk."""
    if INVOICE_FILE.exists():
        data = json.loads(INVOICE_FILE.read_text())
        data["status"] = "void"
        INVOICE_FILE.write_text(json.dumps(data, indent=2))
        print(f"  [compensate] Voided invoice {invoice_id} on disk")
    else:
        print(f"  [compensate] Invoice file not found (already cleaned up)")


# -- Guarded side-effect step -----------------------------------------------

@guard(side_effect=True, compensate=cancel_invoice)
async def create_invoice(customer: str, amount: float) -> str:
    """Create an invoice. Writes a real JSON file to disk."""
    invoice_id = f"INV-{customer.upper()[:4]}-001"
    data = {
        "id": invoice_id,
        "customer": customer,
        "amount": amount,
        "status": "open",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    INVOICE_FILE.write_text(json.dumps(data, indent=2))
    print(f"  [side-effect] Wrote {INVOICE_FILE.name}")
    print(f"  [side-effect] Invoice {invoice_id} created for ${amount:.2f}")
    return invoice_id


# -- Step that will fail ----------------------------------------------------

@guard
async def send_confirmation_email(invoice_id: str, recipient: str) -> str:
    """Simulate an email send that fails."""
    raise RuntimeError(f"SMTP connection refused: unable to send to {recipient}")


# -- Orchestrator -----------------------------------------------------------

async def main() -> None:
    print("Fuze AI -- Side Effects Example\n")

    # Clean up any leftover file from a previous run
    if INVOICE_FILE.exists():
        INVOICE_FILE.unlink()

    customer = "Acme Corp"
    amount = 499.99
    recipient = "billing@acme.example.com"

    invoice_id = None
    try:
        # Step 1: create the invoice (real file written to disk)
        print("Step 1: Creating invoice...")
        invoice_id = await create_invoice(customer, amount)
        print(f"  Invoice ID: {invoice_id}")
        print(f"  File exists: {INVOICE_FILE.exists()}\n")

        # Step 2: send confirmation email (this will fail)
        print("Step 2: Sending confirmation email...")
        await send_confirmation_email(invoice_id, recipient)

    except RuntimeError as exc:
        print(f"  [error] {exc}\n")
        print("Step 2 failed. Running compensation...")

        # In a full Fuze daemon pipeline the compensation fires automatically.
        # Here we show the manual invocation for clarity.
        if invoice_id is not None:
            await cancel_invoice(invoice_id)

    print()

    # Verify the invoice was voided
    if INVOICE_FILE.exists():
        data = json.loads(INVOICE_FILE.read_text())
        print(f'Invoice status on disk: "{data["status"]}"')
        INVOICE_FILE.unlink()

    print("\nDone. The invoice was created (real file) then voided via compensation.")
    print("Check ./fuze-traces.jsonl for the side-effect trace.")


if __name__ == "__main__":
    asyncio.run(main())
