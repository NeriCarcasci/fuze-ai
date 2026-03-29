# 04 - Side-Effect Tracking & Compensation

Demonstrates how Fuze tracks functions that produce real-world side effects and
how compensation handlers provide rollback capability.

## What this example shows

1. **`createInvoice`** is wrapped with `guard(fn, { sideEffect: true, compensate })`.
   It succeeds, so Fuze records the side effect and remembers the compensation
   function (`cancelInvoice`).

2. **`sendEmail`** is also wrapped with a side-effect guard and a compensate
   handler. It *fails* with a simulated SMTP error, so Fuze never records a
   side effect for it (the function threw before producing a result).

3. When a run is killed (budget exceeded, loop detected, or explicit rollback),
   Fuze calls each registered compensation function in **reverse chronological
   order** -- only for steps whose side effects were actually recorded.

## Key API

```ts
import { guard } from 'fuze-ai'

const safeFn = guard(riskyFunction, {
  sideEffect: true,                // tells Fuze this call has real-world consequences
  compensate: async (result) => {  // called during rollback with the original return value
    await undoTheChange(result)
  },
})
```

## Run it

```bash
npm install
npm start
```

## Expected output

```
Fuze AI -- Side-Effect Tracking & Compensation

Step 1: Creating invoice...
  [billing] Created invoice inv_... for $249.99
  Invoice created: inv_...

Step 2: Sending confirmation email...
  Email FAILED: SMTP error: connection to mail server timed out

--- Fuze side-effect summary ---
Invoice in DB: [ { id: 'inv_...', customerId: 'cust_42', amount: 249.99, status: 'open' } ]

Because createInvoice was marked sideEffect: true with a
compensate handler, Fuze knows how to roll it back.
...
```
