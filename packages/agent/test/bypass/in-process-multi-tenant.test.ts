import { describe, expect, it } from 'vitest'
import { InProcessSandbox, SimpleTenantWatchdog } from '../../src/sandbox/in-process.js'
import { SandboxRefusedError } from '../../src/sandbox/types.js'
import { makeTenantId, makePrincipalId, makeRunId, makeStepId } from '../../src/types/brand.js'
import type { Ctx } from '../../src/types/ctx.js'

const ctx = (tenant: string): Ctx<unknown> => ({
  tenant: makeTenantId(tenant),
  principal: makePrincipalId('p'),
  runId: makeRunId('r'),
  stepId: makeStepId('s'),
  deps: {},
  secrets: { ref: () => ({}) as never, resolve: async () => '' },
  attribute: () => undefined,
  invoke: async () => {
    throw new Error('unused')
  },
})

describe('bypass: in-process multi-tenant refusal', () => {
  it('refuses second tenant within the watchdog window', async () => {
    const watchdog = new SimpleTenantWatchdog()
    const sb = new InProcessSandbox({ tenantWatchdog: watchdog })
    await sb.exec({ command: 'echo hi' }, ctx('tenant-a'))
    await expect(sb.exec({ command: 'echo hi' }, ctx('tenant-b'))).rejects.toBeInstanceOf(SandboxRefusedError)
  })

  it('allows the same tenant repeatedly', async () => {
    const watchdog = new SimpleTenantWatchdog()
    const sb = new InProcessSandbox({ tenantWatchdog: watchdog })
    const a = await sb.exec({ command: 'echo a' }, ctx('tenant-a'))
    const b = await sb.exec({ command: 'echo b' }, ctx('tenant-a'))
    expect(a.exitCode).toBe(0)
    expect(b.exitCode).toBe(0)
  })
})
