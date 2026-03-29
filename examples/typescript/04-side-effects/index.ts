import { guard } from 'fuze-ai'

// --- Simulated services ---

interface Invoice {
  id: string
  customerId: string
  amount: number
  status: 'open' | 'void'
}

const invoiceDb: Invoice[] = []

async function createInvoice(customerId: string, amount: number): Promise<Invoice> {
  await new Promise(r => setTimeout(r, 150))
  const invoice: Invoice = {
    id: `inv_${Date.now()}`,
    customerId,
    amount,
    status: 'open',
  }
  invoiceDb.push(invoice)
  console.log(`  [billing] Created invoice ${invoice.id} for $${amount.toFixed(2)}`)
  return invoice
}

async function sendEmail(to: string, subject: string): Promise<void> {
  await new Promise(r => setTimeout(r, 100))
  // Simulate a transient email-provider failure
  throw new Error(`SMTP error: connection to mail server timed out`)
}

// --- Compensation handlers ---

async function cancelInvoice(result: unknown): Promise<void> {
  const invoice = result as Invoice
  invoice.status = 'void'
  console.log(`  [compensation] Voided invoice ${invoice.id}`)
}

async function unsendEmail(_result: unknown): Promise<void> {
  // In real life you might recall a scheduled send or mark it cancelled.
  console.log(`  [compensation] Recalled email (no-op, send had failed)`)
}

// --- Guarded functions ---

const protectedCreateInvoice = guard(createInvoice, {
  sideEffect: true,
  compensate: cancelInvoice,
})

const protectedSendEmail = guard(sendEmail, {
  sideEffect: true,
  compensate: unsendEmail,
})

// --- Main workflow ---

async function main() {
  console.log('Fuze AI — Side-Effect Tracking & Compensation\n')

  // Step 1: create invoice (succeeds)
  console.log('Step 1: Creating invoice...')
  const invoice = await protectedCreateInvoice('cust_42', 249.99)
  console.log(`  Invoice created: ${invoice.id}\n`)

  // Step 2: send confirmation email (fails)
  console.log('Step 2: Sending confirmation email...')
  try {
    await protectedSendEmail('billing@acme.co', `Invoice ${invoice.id}`)
    console.log('  Email sent successfully.\n')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.log(`  Email FAILED: ${message}\n`)
  }

  // --- Show what Fuze tracked ---
  console.log('--- Fuze side-effect summary ---')
  console.log('Invoice in DB:', invoiceDb)
  console.log()
  console.log('Because createInvoice was marked sideEffect: true with a')
  console.log('compensate handler, Fuze knows how to roll it back.')
  console.log('The sendEmail step also had a compensate handler, but its')
  console.log('side-effect was never recorded (it threw before completing).')
  console.log()
  console.log('In a real agent loop, if the run is killed (budget or loop),')
  console.log('Fuze calls each compensation function in reverse order.')
  console.log()
  console.log('Check ./fuze-traces.jsonl for the full trace.')
}

main().catch(console.error)
