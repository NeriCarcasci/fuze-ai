import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import {
  makePrincipalId,
  makeRunId,
  makeStepId,
  makeTenantId,
  type Ctx,
} from '@fuze-ai/agent'
import {
  E2BSandbox,
  RealE2BClientFactory,
  type E2BClient,
} from '../src/index.js'

// .env.local is a developer convenience: when CI_LIVE_E2B is already set in
// the shell environment, we additionally pick up the API key from disk. It
// is NOT a way to opt into live tests by default — that gate is
// `process.env.CI_LIVE_E2B`.
const loadEnvFromDotfile = (): void => {
  if (process.env['CI_LIVE_E2B'] !== '1') return
  if (process.env['E2B_API_KEY'] !== undefined) return
  try {
    const text = readFileSync('D:/Fuze-systems/fuze/.env.local', 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (trimmed === '' || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      const value = trimmed.slice(eq + 1).trim()
      if (key === 'E2B_API_KEY' && process.env[key] === undefined) {
        process.env[key] = value
      }
    }
  } catch {
    /* file is optional */
  }
}

loadEnvFromDotfile()

const liveEnabled = process.env['CI_LIVE_E2B'] === '1'

interface UpstreamSandbox {
  readonly sandboxId: string
  commands: {
    run(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }>
  }
  kill(): Promise<void>
}

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

describe.skipIf(!liveEnabled)('E2B live (gated by CI_LIVE_E2B=1)', () => {
  let createdSandboxes: E2BClient[] = []
  let toDispose: Array<{ dispose: () => Promise<void> }> = []

  afterEach(async () => {
    for (const c of createdSandboxes) {
      try {
        await c.kill()
      } catch {
        /* best-effort */
      }
    }
    createdSandboxes = []
    for (const d of toDispose) {
      try {
        await d.dispose()
      } catch {
        /* best-effort */
      }
    }
    toDispose = []
  })

  it('runs `echo hello` end-to-end and reports exitCode 0', async () => {
    const apiKey = process.env['E2B_API_KEY']
    if (apiKey === undefined || apiKey.length === 0) {
      throw new Error('E2B_API_KEY not set')
    }
    const factory = new RealE2BClientFactory({ apiKey })
    const sandbox = new E2BSandbox({ factory })
    toDispose.push(sandbox)

    const out = await sandbox.exec({ command: 'echo hello' }, stubCtx())
    expect(out.exitCode).toBe(0)
    expect(out.stdout).toContain('hello')
    expect(out.tier).toBe('vm-managed')

    console.log(
      'e2b basic:',
      JSON.stringify({
        tier: out.tier,
        exitCode: out.exitCode,
        durationMs: out.durationMs,
        stdoutLen: out.stdout.length,
        stdoutSample: out.stdout.slice(0, 32),
      }),
    )
  }, 60_000)

  // The upstream e2b SDK at v1.13.x exposes Sandbox.connect() for reattaching
  // to a running sandbox by ID, but does not expose pause/resume on the public
  // type surface (the Embedded factory's pause() forwards to upstream.pause()
  // which is not implemented in this SDK build). The state-survives-reattach
  // property is what the loop actually relies on; we exercise it via the
  // upstream Sandbox class directly. When pause/resume lands upstream, swap
  // this for `factory.resume(id, ...)` and the test still asserts the same
  // invariant.
  it('survives reattach — file written via one client is readable via another', async () => {
    const apiKey = process.env['E2B_API_KEY']
    if (apiKey === undefined || apiKey.length === 0) {
      throw new Error('E2B_API_KEY not set')
    }
    const { Sandbox } = (await import('e2b')) as unknown as {
      Sandbox: {
        create(opts: { apiKey: string }): Promise<UpstreamSandbox>
        connect(id: string, opts: { apiKey: string }): Promise<UpstreamSandbox>
      }
    }

    const first = await Sandbox.create({ apiKey })
    let killed = false
    try {
      const writeRes = await first.commands.run(
        'echo persisted-data > /tmp/fuze-live-marker.txt',
      )
      expect(writeRes.exitCode).toBe(0)

      const sandboxId = first.sandboxId
      expect(typeof sandboxId).toBe('string')
      expect(sandboxId.length).toBeGreaterThan(0)

      const reattached = await Sandbox.connect(sandboxId, { apiKey })
      const readRes = await reattached.commands.run('cat /tmp/fuze-live-marker.txt')
      expect(readRes.exitCode).toBe(0)
      expect(readRes.stdout).toContain('persisted-data')

      console.log(
        'e2b reattach:',
        JSON.stringify({
          sandboxIdLen: sandboxId.length,
          readExit: readRes.exitCode,
          readStdoutSample: readRes.stdout.trim().slice(0, 32),
        }),
      )

      await reattached.kill()
      killed = true
    } finally {
      if (!killed) {
        try {
          await first.kill()
        } catch {
          /* best-effort */
        }
      }
    }
  }, 90_000)

  it('resolves tier=vm-managed when E2B_DOMAIN unset and vm-self-hosted when set', () => {
    const factory = new RealE2BClientFactory({ apiKey: 'unused-for-tier-shape' })
    const managed = new E2BSandbox({ factory })
    expect(managed.tier).toBe('vm-managed')

    const selfHosted = new E2BSandbox({
      factory,
      e2bDomain: process.env['E2B_DOMAIN'] ?? 'sandbox.fuze.example',
    })
    expect(selfHosted.tier).toBe('vm-self-hosted')
  })
})
