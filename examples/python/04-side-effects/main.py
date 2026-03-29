"""
Fuze AI -- Example 04: Side Effects and Compensation

Demonstrates side-effect tracking with automatic compensation.
An invoice is created (side effect), then a follow-up email step
fails. Fuze automatically calls the compensate function to roll
back the invoice.
"""

import asyncio
from fuze_ai import guard


# -- Compensation function --------------------------------------------------

async def cancel_invoice(invoice_id: str) -> None:
    """Compensate by cancelling the invoice that was created."""
    print(f"  [compensate] Cancelling invoice {invoice_id}...")
    await asyncio.sleep(0.1)
    print(f"  [compensate] Invoice {invoice_id} cancelled.")


# -- Guarded side-effect step -----------------------------------------------

@guard(side_effect=True, compensate=cancel_invoice)
async def create_invoice(customer: str, amount: float) -> str:
    """Create an invoice. This is a side effect that can be rolled back."""
    await asyncio.sleep(0.1)
    invoice_id = f"INV-{customer.upper()[:4]}-001"
    print(f"  [side-effect] Invoice {invoice_id} created for ${amount:.2f}")
    return invoice_id


# -- Step that will fail ----------------------------------------------------

@guard
async def send_confirmation_email(invoice_id: str, recipient: str) -> str:
    """Simulate an email send that fails."""
    await asyncio.sleep(0.1)
    raise RuntimeError(f"SMTP connection refused: unable to send to {recipient}")


# -- Orchestrator -----------------------------------------------------------

async def main() -> None:
    print("Fuze AI -- Side Effects Example\n")

    customer = "Acme Corp"
    amount = 499.99
    recipient = "billing@acme.example.com"

    invoice_id = None
    try:
        # Step 1: create the invoice (side effect)
        print("Step 1: Creating invoice...")
        invoice_id = await create_invoice(customer, amount)
        print(f"  Invoice ID: {invoice_id}\n")

        # Step 2: send confirmation email (this will fail)
        print("Step 2: Sending confirmation email...")
        await send_confirmation_email(invoice_id, recipient)

    except RuntimeError as exc:
        print(f"  [error] {exc}\n")
        print("Step 2 failed. Fuze will compensate the side effect...")

        # In a full Fuze pipeline the compensation fires automatically.
        # Here we show the manual invocation for clarity.
        if invoice_id is not None:
            await cancel_invoice(invoice_id)

    print("\nDone. The invoice was created and then rolled back.")
    print("Check ./fuze-traces.jsonl for the compensation trace.")


if __name__ == "__main__":
    asyncio.run(main())
