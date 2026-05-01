import { describe, expect, it } from 'vitest'
import {
  makePrincipalId,
  makeRunId,
  makeStepId,
  makeTenantId,
  SandboxRefusedError,
  type Ctx,
} from '@fuze-ai/agent'
import {
  JustBashSandbox,
  RealBashFactory,
  type BashLogEntry,
} from '../src/index.js'

const stubCtx = (tenant = 't-live', runId = 'r-live'): Ctx<unknown> => ({
  tenant: makeTenantId(tenant),
  principal: makePrincipalId('p-live'),
  runId: makeRunId(runId),
  stepId: makeStepId('s-live'),
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

const liveEnabled = process.env['CI_LIVE_JUSTBASH'] === '1'

describe.skipIf(!liveEnabled)('just-bash live (gated by CI_LIVE_JUSTBASH=1)', () => {
  it('runs `echo hello` and reports stdout', async () => {
    const sandbox = new JustBashSandbox({ factory: new RealBashFactory() })
    const out = await sandbox.exec({ command: 'echo hello' }, stubCtx('t-echo'))
    expect(out.exitCode).toBe(0)
    expect(out.stdout).toContain('hello')
    expect(out.tier).toBe('in-process')
    console.log(
      'just-bash echo:',
      JSON.stringify({
        exitCode: out.exitCode,
        durationMs: out.durationMs,
        stdoutSample: out.stdout.trim().slice(0, 32),
      }),
    )
  })

  it('runs `cat` with stdin and emits the same bytes', async () => {
    const sandbox = new JustBashSandbox({ factory: new RealBashFactory() })
    const payload = 'piped-in-data-' + Math.random().toString(36).slice(2, 8)
    const out = await sandbox.exec(
      { command: 'cat', stdin: payload },
      stubCtx('t-cat'),
    )
    expect(out.exitCode).toBe(0)
    expect(out.stdout).toContain(payload)
  })

  it('runs a piped pipeline `echo foo | tr a-z A-Z`', async () => {
    const sandbox = new JustBashSandbox({ factory: new RealBashFactory() })
    const out = await sandbox.exec(
      { command: 'echo foo | tr a-z A-Z' },
      stubCtx('t-pipe'),
    )
    expect(out.exitCode).toBe(0)
    expect(out.stdout).toContain('FOO')
  })

  it('refuses a second tenant within the watchdog window', async () => {
    const sandbox = new JustBashSandbox({ factory: new RealBashFactory() })
    await sandbox.exec({ command: 'echo first' }, stubCtx('tenant-A', 'run-A'))
    await expect(
      sandbox.exec({ command: 'echo second' }, stubCtx('tenant-B', 'run-B')),
    ).rejects.toBeInstanceOf(SandboxRefusedError)
  })

  it('fires onLog with one entry per exec', async () => {
    const logs: BashLogEntry[] = []
    const sandbox = new JustBashSandbox({
      factory: new RealBashFactory(),
      onLog: (e) => logs.push(e),
    })
    const ctx = stubCtx('t-log', 'r-log')
    await sandbox.exec({ command: 'echo a' }, ctx)
    await sandbox.exec({ command: 'echo b' }, ctx)
    expect(logs).toHaveLength(2)
    expect(logs[0]?.command).toBe('echo a')
    expect(logs[0]?.tenant).toBe('t-log')
    expect(logs[0]?.runId).toBe('r-log')
    expect(logs[0]?.exitCode).toBe(0)
    expect(logs[1]?.command).toBe('echo b')
  })
})
