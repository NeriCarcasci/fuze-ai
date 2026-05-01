import { describe, expect, it, vi } from 'vitest'
import {
  makePrincipalId,
  makeRunId,
  makeStepId,
  makeTenantId,
  SandboxRefusedError,
  SimpleTenantWatchdog,
} from '@fuze-ai/agent'
import { runSandboxConformance } from '@fuze-ai/agent/conformance'
import type { Ctx } from '@fuze-ai/agent'
import { FakeBashFactory, JustBashSandbox } from '../src/index.js'
import type { BashFetchEntry, BashLogEntry } from '../src/index.js'

const buildCtx = (tenant = 't1', runId = 'r1'): Ctx<unknown> => ({
  tenant: makeTenantId(tenant),
  principal: makePrincipalId('p1'),
  runId: makeRunId(runId),
  stepId: makeStepId('s1'),
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

describe('JustBashSandbox', () => {
  it('echoes a basic command', async () => {
    const sb = new JustBashSandbox({ factory: new FakeBashFactory() })
    const out = await sb.exec({ command: 'echo hello' }, buildCtx())
    expect(out.stdout).toBe('hello\n')
    expect(out.exitCode).toBe(0)
    expect(out.tier).toBe('in-process')
  })

  it('runs cat with stdin', async () => {
    const sb = new JustBashSandbox({ factory: new FakeBashFactory() })
    const out = await sb.exec({ command: 'cat', stdin: 'piped-in-data' }, buildCtx())
    expect(out.stdout).toBe('piped-in-data')
    expect(out.exitCode).toBe(0)
  })

  it('persists state across two exec calls in the same run', async () => {
    const sb = new JustBashSandbox({ factory: new FakeBashFactory() })
    const ctx = buildCtx('t-persist', 'r-persist')
    await sb.exec({ command: 'export FOO=bar' }, ctx)
    const out = await sb.exec({ command: 'printenv FOO' }, ctx)
    expect(out.stdout).toBe('bar\n')
    expect(out.exitCode).toBe(0)
  })

  it('persists virtual filesystem writes within a run', async () => {
    const sb = new JustBashSandbox({ factory: new FakeBashFactory() })
    const ctx = buildCtx('t-fs', 'r-fs')
    await sb.exec({ command: 'write /docs/notes.txt hello-world' }, ctx)
    const out = await sb.exec({ command: 'read /docs/notes.txt' }, ctx)
    expect(out.stdout).toBe('hello-world')
  })

  it('different runIds get different Bash instances', async () => {
    const watchdog = new SimpleTenantWatchdog()
    const sb = new JustBashSandbox({ factory: new FakeBashFactory(), tenantWatchdog: watchdog })
    const ctxA = buildCtx('t-iso', 'run-a')
    const ctxB = buildCtx('t-iso', 'run-b')
    await sb.exec({ command: 'export FOO=A' }, ctxA)
    await sb.exec({ command: 'export FOO=B' }, ctxB)
    const a = await sb.exec({ command: 'printenv FOO' }, ctxA)
    const b = await sb.exec({ command: 'printenv FOO' }, ctxB)
    expect(a.stdout).toBe('A\n')
    expect(b.stdout).toBe('B\n')
  })

  it('refuses a second tenant within the watchdog window', async () => {
    const sb = new JustBashSandbox({ factory: new FakeBashFactory() })
    await sb.exec({ command: 'echo one' }, buildCtx('tenant-1'))
    await expect(sb.exec({ command: 'echo two' }, buildCtx('tenant-2'))).rejects.toBeInstanceOf(
      SandboxRefusedError,
    )
  })

  it('fires onLog callback per exec', async () => {
    const logs: BashLogEntry[] = []
    const sb = new JustBashSandbox({
      factory: new FakeBashFactory(),
      onLog: (e) => logs.push(e),
    })
    const ctx = buildCtx('t-log', 'r-log')
    await sb.exec({ command: 'echo a' }, ctx)
    await sb.exec({ command: 'echo b' }, ctx)
    expect(logs).toHaveLength(2)
    expect(logs[0]?.command).toBe('echo a')
    expect(logs[0]?.tenant).toBe('t-log')
    expect(logs[0]?.runId).toBe('r-log')
    expect(logs[0]?.exitCode).toBe(0)
    expect(logs[1]?.command).toBe('echo b')
  })

  it('reports tier as in-process', async () => {
    const sb = new JustBashSandbox({ factory: new FakeBashFactory() })
    expect(sb.tier).toBe('in-process')
    const out = await sb.exec({ command: 'echo t' }, buildCtx())
    expect(out.tier).toBe('in-process')
  })

  it('populates threatBoundary correctly with no allowed fetch prefixes', () => {
    const sb = new JustBashSandbox({ factory: new FakeBashFactory() })
    expect(sb.threatBoundary.trustedCallers).toEqual(['agent-loop'])
    expect(sb.threatBoundary.observesSecrets).toBe(true)
    expect(sb.threatBoundary.readsFilesystem).toBe(true)
    expect(sb.threatBoundary.writesFilesystem).toBe(true)
    expect(sb.threatBoundary.egressDomains).toBe('none')
  })

  it('populates threatBoundary egressDomains from allowedFetchPrefixes', () => {
    const sb = new JustBashSandbox({
      factory: new FakeBashFactory(),
      allowedFetchPrefixes: ['https://api.example.com/'],
    })
    expect(sb.threatBoundary.egressDomains).toEqual(['https://api.example.com/'])
  })

  it('returns exitCode 124 on timeout', async () => {
    const factory = {
      create: () => ({
        exec: (_cmd: string, opts?: { signal?: AbortSignal }) =>
          new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
            const t = setTimeout(
              () => resolve({ stdout: 'never', stderr: '', exitCode: 0 }),
              5000,
            )
            opts?.signal?.addEventListener('abort', () => {
              clearTimeout(t)
              reject(new Error('aborted'))
            })
          }),
      }),
    }
    const sb = new JustBashSandbox({ factory, defaultTimeoutMs: 25 })
    const out = await sb.exec({ command: 'sleep-forever' }, buildCtx('t-timeout'))
    expect(out.exitCode).toBe(124)
    expect(out.stderr).toContain('timeout')
  })

  it('truncates oversize stdout', async () => {
    const big = 'x'.repeat(50_000)
    const factory = {
      create: () => ({
        exec: async () => ({ stdout: big, stderr: '', exitCode: 0 }),
      }),
    }
    const sb = new JustBashSandbox({ factory, maxStdoutBytes: 100 })
    const out = await sb.exec({ command: 'big' }, buildCtx('t-trunc'))
    expect(out.stdout.length).toBe(100)
    expect(out.truncated).toBe(true)
  })

  it('returns exit 127 for unknown command via fake factory', async () => {
    const sb = new JustBashSandbox({ factory: new FakeBashFactory() })
    const out = await sb.exec({ command: 'nonsense-zzz' }, buildCtx('t-unk'))
    expect(out.exitCode).toBe(127)
  })

  it('forwards onFetch when fetch hook is wired', async () => {
    const fetches: BashFetchEntry[] = []
    let captured: ((url: string, init?: { method?: string }) => Promise<Response>) | undefined
    const factory = {
      create: (opts: { fetch?: (url: string, init?: { method?: string }) => Promise<Response> }) => {
        captured = opts.fetch
        return {
          exec: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
        }
      },
    }
    const sb = new JustBashSandbox({
      factory,
      allowedFetchPrefixes: ['https://allowed.example/'],
      onFetch: (e) => fetches.push(e),
    })
    await sb.exec({ command: 'noop' }, buildCtx('t-fetch', 'r-fetch'))
    expect(captured).toBeDefined()
    const realFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'))
    await captured!('https://allowed.example/x', { method: 'POST' })
    expect(fetches).toHaveLength(1)
    expect(fetches[0]?.url).toBe('https://allowed.example/x')
    expect(fetches[0]?.method).toBe('POST')
    expect(fetches[0]?.tenant).toBe('t-fetch')
    expect(fetches[0]?.runId).toBe('r-fetch')
    realFetch.mockRestore()
  })

  it('rejects fetch outside allowedFetchPrefixes', async () => {
    let captured: ((url: string, init?: { method?: string }) => Promise<Response>) | undefined
    const factory = {
      create: (opts: { fetch?: (url: string, init?: { method?: string }) => Promise<Response> }) => {
        captured = opts.fetch
        return { exec: async () => ({ stdout: '', stderr: '', exitCode: 0 }) }
      },
    }
    const sb = new JustBashSandbox({
      factory,
      allowedFetchPrefixes: ['https://allowed.example/'],
      onFetch: () => undefined,
    })
    await sb.exec({ command: 'noop' }, buildCtx('t-deny'))
    await expect(captured!('https://evil.example/x')).rejects.toThrow(/fetch denied/)
  })

  it('dispose clears cached instances', async () => {
    const sb = new JustBashSandbox({ factory: new FakeBashFactory() })
    const ctx = buildCtx('t-disp', 'r-disp')
    await sb.exec({ command: 'export FOO=keep' }, ctx)
    await sb.dispose()
    const out = await sb.exec({ command: 'printenv FOO' }, ctx)
    expect(out.exitCode).toBe(1)
  })
})

runSandboxConformance(
  'JustBashSandbox',
  () => new JustBashSandbox({ factory: new FakeBashFactory() }),
  { skipNetwork: true },
)
