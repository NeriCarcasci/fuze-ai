#!/usr/bin/env node
import('../dist/cli.js').then((m) => m.main(process.argv.slice(2))).catch((err) => {
  process.stderr.write(`fuze: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
