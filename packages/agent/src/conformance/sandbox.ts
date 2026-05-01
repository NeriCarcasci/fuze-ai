import { describe, expect, it } from 'vitest'
import type { FuzeSandbox } from '../sandbox/types.js'
import type { Ctx } from '../types/ctx.js'
import { makeRunId, makeStepId, makeTenantId, makePrincipalId } from '../types/brand.js'

const stubCtx = (tenant = 't-conf'): Ctx<unknown> => ({
  tenant: makeTenantId(tenant),
  principal: makePrincipalId('p-conf'),
  runId: makeRunId('r-conf'),
  stepId: makeStepId('s-conf'),
  deps: {},
  secrets: {
    ref: () => {
      throw new Error('not used')
    },
    resolve: async () => '',
  },
  attribute: () => undefined,
  invoke: async () => {
    throw new Error('not used')
  },
})

export interface SandboxConformanceOptions {
  readonly skipNetwork?: boolean
  readonly skipFilesystem?: boolean
}

export const runSandboxConformance = (
  name: string,
  factory: () => FuzeSandbox | Promise<FuzeSandbox>,
  opts: SandboxConformanceOptions = {},
): void => {
  describe(`Sandbox conformance: ${name}`, () => {
    it('declares a tier in its output', async () => {
      const sb = await factory()
      const out = await sb.exec({ command: 'echo hello' }, stubCtx())
      expect(out.tier).toBeDefined()
      expect(['in-process', 'vm-managed', 'vm-self-hosted']).toContain(out.tier)
    })

    it('echoes stdout for a basic command', async () => {
      const sb = await factory()
      const out = await sb.exec({ command: 'echo hello' }, stubCtx())
      expect(out.stdout).toContain('hello')
      expect(out.exitCode).toBe(0)
    })

    it('reports duration as a positive number', async () => {
      const sb = await factory()
      const out = await sb.exec({ command: 'echo timing' }, stubCtx())
      expect(out.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('returns non-zero exit code on unknown command', async () => {
      const sb = await factory()
      const out = await sb.exec({ command: 'this-is-not-a-real-command-zzzzz' }, stubCtx())
      expect(out.exitCode).not.toBe(0)
    })

    it('exposes a threatBoundary', async () => {
      const sb = await factory()
      expect(sb.threatBoundary).toBeDefined()
      expect(sb.threatBoundary.trustedCallers.length).toBeGreaterThan(0)
    })

    if (opts.skipNetwork !== true) {
      it('is consistent across two calls in the same tenant', async () => {
        const sb = await factory()
        const ctx = stubCtx()
        const a = await sb.exec({ command: 'echo a' }, ctx)
        const b = await sb.exec({ command: 'echo b' }, ctx)
        expect(a.tier).toBe(b.tier)
      })
    }
  })
}
