import { execFileSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

const runTypecheck = (source: string): { ok: boolean; output: string } => {
  const checkFile = join(process.cwd(), 'bypass-tool-calls-tool.tmp.ts')
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
        '--exactOptionalPropertyTypes',
        '--noUncheckedIndexedAccess',
        '--types',
        'node',
        checkFile,
      ],
      { cwd: process.cwd(), stdio: 'pipe' },
    )
    return { ok: true, output: '' }
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer }
    return { ok: false, output: (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? '') }
  } finally {
    rmSync(checkFile, { force: true })
  }
}

describe('bypass: tool-calls-tool (type level)', () => {
  it('a tool function does not see other tools through Ctx.deps', { timeout: 30000 }, () => {
    const result = runTypecheck(`
import type { Ctx } from './src/types/ctx.js'
import type { AnyFuzeTool } from './src/types/tool.js'

const handler = async (ctx: Ctx<{ readonly userId: string }>) => {
  // @ts-expect-error deps does not contain a 'otherTool' property
  void ctx.deps.otherTool
  // @ts-expect-error Ctx has no 'tools' surface
  void ctx.tools
  // ctx.invoke is the only legal sibling-tool path
  const ok: typeof ctx.invoke = ctx.invoke
  void ok
}
void handler
`)
    expect(result.ok, result.output).toBe(true)
  })

  it('Ctx exposes only attribute and invoke as imperative surfaces', { timeout: 30000 }, () => {
    const result = runTypecheck(`
import type { Ctx } from './src/types/ctx.js'

const handler = async (ctx: Ctx<unknown>) => {
  // @ts-expect-error startSpan is not on Ctx
  void ctx.startSpan
  // @ts-expect-error tracer is not on Ctx
  void ctx.tracer
  void ctx.attribute
  void ctx.invoke
}
void handler
`)
    expect(result.ok, result.output).toBe(true)
  })
})
