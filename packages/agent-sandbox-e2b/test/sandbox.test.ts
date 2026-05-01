import { describe, expect, it } from 'vitest'
import {
  makePrincipalId,
  makeRunId,
  makeStepId,
  makeTenantId,
  type Ctx,
} from '@fuze-ai/agent'
import { runSandboxConformance } from '@fuze-ai/agent/conformance'
import { E2BSandbox, FakeE2BClientFactory, type E2BSandboxLogEntry } from '../src/index.js'

const stubCtx = (tenant = 't-test', runId = 'r-test'): Ctx<unknown> => ({
  tenant: makeTenantId(tenant),
  principal: makePrincipalId('p-test'),
  runId: makeRunId(runId),
  stepId: makeStepId('s-test'),
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

describe('E2BSandbox', () => {
  it('echoes a command via the underlying client', async () => {
    const factory = new FakeE2BClientFactory()
    const sb = new E2BSandbox({ factory })
    const out = await sb.exec({ command: 'echo hello' }, stubCtx())
    expect(out.stdout).toBe('hello\n')
    expect(out.exitCode).toBe(0)
    expect(out.tier).toBe('vm-managed')
  })

  it('reports tier=vm-managed when e2bDomain is unset', () => {
    const sb = new E2BSandbox({ factory: new FakeE2BClientFactory() })
    expect(sb.tier).toBe('vm-managed')
  })

  it('reports tier=vm-self-hosted when e2bDomain is set', () => {
    const sb = new E2BSandbox({
      factory: new FakeE2BClientFactory(),
      e2bDomain: 'sandbox.fuze.example',
    })
    expect(sb.tier).toBe('vm-self-hosted')
  })

  it('threatBoundary is populated with agent-loop trustedCaller and observesSecrets=false', () => {
    const sb = new E2BSandbox({
      factory: new FakeE2BClientFactory(),
      allowedEgressDomains: ['api.example.com'],
    })
    expect(sb.threatBoundary.trustedCallers).toEqual(['agent-loop'])
    expect(sb.threatBoundary.observesSecrets).toBe(false)
    expect(sb.threatBoundary.readsFilesystem).toBe(true)
    expect(sb.threatBoundary.writesFilesystem).toBe(true)
    expect(sb.threatBoundary.egressDomains).toEqual(['api.example.com'])
  })

  it('defaults egressDomains to "none" when not provided', () => {
    const sb = new E2BSandbox({ factory: new FakeE2BClientFactory() })
    expect(sb.threatBoundary.egressDomains).toBe('none')
  })

  it('different runIds get different sandboxes', async () => {
    const factory = new FakeE2BClientFactory()
    const sb = new E2BSandbox({ factory })
    await sb.exec({ command: 'echo a' }, stubCtx('t', 'run-1'))
    await sb.exec({ command: 'echo b' }, stubCtx('t', 'run-2'))
    expect(factory.created).toHaveLength(2)
  })

  it('reuses the same sandbox across calls within one (tenant, runId)', async () => {
    const factory = new FakeE2BClientFactory()
    const sb = new E2BSandbox({ factory })
    await sb.exec({ command: 'echo a' }, stubCtx('t', 'run-1'))
    await sb.exec({ command: 'echo b' }, stubCtx('t', 'run-1'))
    expect(factory.created).toHaveLength(1)
    expect(factory.created[0]!.runs).toHaveLength(2)
  })

  it('dispose() kills all sandboxes', async () => {
    const factory = new FakeE2BClientFactory()
    const sb = new E2BSandbox({ factory })
    await sb.exec({ command: 'echo a' }, stubCtx('t', 'run-1'))
    await sb.exec({ command: 'echo b' }, stubCtx('t', 'run-2'))
    await sb.dispose()
    expect(factory.created.every((c) => c.killed)).toBe(true)
  })

  it('pipes stdin into the client', async () => {
    const factory = new FakeE2BClientFactory()
    const sb = new E2BSandbox({ factory })
    const out = await sb.exec({ command: 'cat', stdin: 'piped-in' }, stubCtx())
    expect(out.stdout).toBe('piped-in')
  })

  it('onLog callback fires for stdout chunks', async () => {
    const events: E2BSandboxLogEntry[] = []
    const factory = new FakeE2BClientFactory()
    const sb = new E2BSandbox({ factory, onLog: (e) => events.push(e) })
    await sb.exec({ command: 'echo logged' }, stubCtx('t-log', 'r-log'))
    expect(events.length).toBeGreaterThan(0)
    expect(events[0]!.stream).toBe('stdout')
    expect(events[0]!.tenant).toBe('t-log')
    expect(events[0]!.runId).toBe('r-log')
  })

  it('returns exitCode 124 when the underlying client times out', async () => {
    const factory = new FakeE2BClientFactory({ slowMs: 50 })
    const sb = new E2BSandbox({ factory })
    const out = await sb.exec({ command: 'echo slow', timeoutMs: 10 }, stubCtx())
    expect(out.exitCode).toBe(124)
    expect(out.stderr).toMatch(/timeout/i)
  })

  it('returns non-zero exit code on unrecognised command', async () => {
    const factory = new FakeE2BClientFactory()
    const sb = new E2BSandbox({ factory })
    const out = await sb.exec({ command: 'this-is-not-a-real-command' }, stubCtx())
    expect(out.exitCode).not.toBe(0)
  })

  it('truncates oversize stdout and reports it', async () => {
    const factory = new FakeE2BClientFactory()
    const sb = new E2BSandbox({ factory, maxStdoutBytes: 4 })
    const out = await sb.exec({ command: 'echo abcdefghij' }, stubCtx())
    expect(out.truncated).toBe(true)
    expect(out.stdout.length).toBe(4)
  })

  it('passes env into the underlying client', async () => {
    const factory = new FakeE2BClientFactory()
    const sb = new E2BSandbox({ factory })
    const out = await sb.exec(
      { command: 'env FOO', env: { FOO: 'bar' } },
      stubCtx(),
    )
    expect(out.stdout).toBe('bar\n')
  })
})

runSandboxConformance(
  'E2BSandbox (managed, fake client)',
  () => new E2BSandbox({ factory: new FakeE2BClientFactory() }),
  { skipNetwork: true },
)

runSandboxConformance(
  'E2BSandbox (self-hosted, fake client)',
  () =>
    new E2BSandbox({
      factory: new FakeE2BClientFactory(),
      e2bDomain: 'sandbox.fuze.example',
    }),
  { skipNetwork: true },
)
