import { execFileSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

function runTypecheck(source: string): void {
  const checkFile = join(process.cwd(), 'exports-check.tmp.ts')

  writeFileSync(checkFile, source, 'utf-8')
  try {
    const tscPath = require.resolve('typescript/bin/tsc')
    execFileSync(
      process.execPath,
      [
        tscPath,
        '--pretty',
        'false',
        '--noEmit',
        '--strict',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        '--target',
        'ES2022',
        '--types',
        'node',
        checkFile,
      ],
      {
        cwd: process.cwd(),
        stdio: 'pipe',
      },
    )
  } finally {
    rmSync(checkFile, { force: true })
  }
}

describe('public exports', () => {
  it('supports type import of FuzeService', () => {
    expect(() => {
      runTypecheck(`
import type { FuzeService } from './src/index.js'

const _service: FuzeService | null = null
void _service
`)
    }).not.toThrow()
  })

  it('exports createService, ApiService, DaemonService, NoopService, and verifyChain', () => {
    expect(() => {
      runTypecheck(`
import { createService, ApiService, DaemonService, NoopService, verifyChain } from './src/index.js'

void [createService, ApiService, DaemonService, NoopService, verifyChain]
`)
    }).not.toThrow()
  })

  it('rejects removed TelemetryTransport/createTransport symbols at compile time', () => {
    expect(() => {
      runTypecheck(`
// @ts-expect-error legacy transport type was removed
import type { TelemetryTransport } from './src/index.js'
// @ts-expect-error legacy transport factory was removed
import { createTransport } from './src/index.js'

void (undefined as unknown as TelemetryTransport | undefined)
void createTransport
`)
    }).not.toThrow()
  })
})
