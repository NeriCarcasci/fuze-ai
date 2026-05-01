// Fuze AI — Example 04: Side Effects & Compensation
//
// Mark a step that touches the outside world with `sideEffect: true` and
// register a compensation handler. If a later step fails, the compensation
// rolls the side-effect back. (In a daemon-backed pipeline the rollback
// fires automatically when the run ends in failure; here we trigger it
// manually for clarity.)

import { guard } from 'fuze-ai'

// Pretend payments service — in-memory only.
type Invoice = { customer: string; amount: number; status: 'open' | 'void' }
const invoices = new Map<string, Invoice>()

async function createInvoice(customer: string, amount: number): Promise<string> {
  const id = `inv_${invoices.size + 1}`
  invoices.set(id, { customer, amount, status: 'open' })
  console.log(`  [side-effect] created ${id} — ${customer} $${amount}`)
  return id
}

async function cancelInvoice(invoiceId: string): Promise<void> {
  const inv = invoices.get(invoiceId)
  if (inv) {
    inv.status = 'void'
    console.log(`  [compensate]  voided ${invoiceId}`)
  }
}

async function sendReceipt(invoiceId: string): Promise<void> {
  throw new Error(`SMTP unreachable (invoice ${invoiceId})`)
}

const guardedCreate = guard(createInvoice, { sideEffect: true, compensate: cancelInvoice })
const guardedSend = guard(sendReceipt, { sideEffect: true })

async function main(): Promise<void> {
  console.log('Fuze AI — Side Effects & Compensation\n')

  console.log('Step 1: create invoice')
  const id = await guardedCreate('Acme Corp', 499.99)

  console.log('\nStep 2: send receipt (fails)')
  try {
    await guardedSend(id)
  } catch (err) {
    console.log(`  failed: ${(err as Error).message}`)
  }

  console.log('\nStep 3: compensate')
  await cancelInvoice(id)

  console.log(`\nFinal status of ${id}: "${invoices.get(id)!.status}"`)
  console.log('Trace: ./fuze-traces.jsonl')
}

main().catch(console.error)
