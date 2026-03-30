import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { guard } from 'fuze-ai'

const INVOICE_FILE = join(import.meta.dirname, 'invoice.json')

interface Invoice {
  id: string
  customerId: string
  amount: number
  status: 'open' | 'void'
  createdAt: string
}

// Real side effect: writes an invoice file to disk
async function createInvoice(customerId: string, amount: number): Promise<Invoice> {
  const invoice: Invoice = {
    id: `inv_${Date.now()}`,
    customerId,
    amount,
    status: 'open',
    createdAt: new Date().toISOString(),
  }
  writeFileSync(INVOICE_FILE, JSON.stringify(invoice, null, 2))
  console.log(`  [side-effect] Wrote ${INVOICE_FILE}`)
  console.log(`  [side-effect] Invoice ${invoice.id}: $${amount.toFixed(2)} for ${customerId}`)
  return invoice
}

// Simulates a step that fails
async function sendConfirmationEmail(invoiceId: string, to: string): Promise<void> {
  throw new Error(`SMTP error: connection to ${to} timed out (invoice: ${invoiceId})`)
}

// Compensation: deletes the invoice file from disk
async function cancelInvoice(result: unknown): Promise<void> {
  const invoice = result as Invoice
  if (existsSync(INVOICE_FILE)) {
    const content = readFileSync(INVOICE_FILE, 'utf-8')
    const saved = JSON.parse(content) as Invoice
    saved.status = 'void'
    writeFileSync(INVOICE_FILE, JSON.stringify(saved, null, 2))
    console.log(`  [compensation] Voided invoice ${invoice.id} on disk`)
  }
}

// Guard with side-effect tracking and compensation handler
const protectedCreateInvoice = guard(createInvoice, {
  sideEffect: true,
  compensate: cancelInvoice,
})

const protectedSendEmail = guard(sendConfirmationEmail, {
  sideEffect: true,
})

async function main() {
  console.log('Fuze AI -- Side-Effect Tracking & Compensation\n')

  // Clean up any leftover invoice from a previous run
  if (existsSync(INVOICE_FILE)) unlinkSync(INVOICE_FILE)

  // Step 1: Create invoice (real file written to disk)
  console.log('Step 1: Creating invoice...')
  const invoice = await protectedCreateInvoice('acme-corp', 499.99)
  console.log(`  File exists: ${existsSync(INVOICE_FILE)}\n`)

  // Step 2: Send email (will fail)
  console.log('Step 2: Sending confirmation email...')
  try {
    await protectedSendEmail(invoice.id, 'billing@acme.example.com')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(`  FAILED: ${msg}\n`)
  }

  // Step 3: Manually trigger compensation (in a real daemon pipeline this is automatic)
  console.log('Step 3: Running compensation...')
  await cancelInvoice(invoice)
  console.log()

  // Verify the invoice was voided
  if (existsSync(INVOICE_FILE)) {
    const final = JSON.parse(readFileSync(INVOICE_FILE, 'utf-8')) as Invoice
    console.log(`Invoice status on disk: "${final.status}"`)
  }

  console.log('\nThe invoice was created (real file) then voided via compensation.')
  console.log('Check ./fuze-traces.jsonl for the side-effect trace.')

  // Clean up
  if (existsSync(INVOICE_FILE)) unlinkSync(INVOICE_FILE)
}

main().catch(console.error)
