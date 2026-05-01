import type {
  Ctx,
  FuzeSandbox,
  SandboxExecInput,
  SandboxExecOutput,
  SandboxTier,
  ThreatBoundary,
} from '@fuze-ai/agent'
import type { E2BClient, E2BClientFactory } from './types.js'

export interface E2BSandboxOptions {
  readonly factory: E2BClientFactory
  readonly e2bDomain?: string
  readonly allowedEgressDomains?: readonly string[]
  readonly defaultTimeoutMs?: number
  readonly maxStdoutBytes?: number
  readonly onLog?: (entry: E2BSandboxLogEntry) => void
}

export interface E2BSandboxLogEntry {
  readonly tenant: string
  readonly runId: string
  readonly stream: 'stdout' | 'stderr'
  readonly chunk: string
}

const sandboxKey = (tenant: string, runId: string): string => `${tenant}::${runId}`

export class E2BSandbox implements FuzeSandbox {
  readonly tier: SandboxTier
  readonly threatBoundary: ThreatBoundary

  private readonly factory: E2BClientFactory
  private readonly domain: string | undefined
  private readonly defaultTimeoutMs: number
  private readonly maxStdoutBytes: number
  private readonly onLog: ((entry: E2BSandboxLogEntry) => void) | undefined
  private readonly clients = new Map<string, Promise<E2BClient>>()

  constructor(opts: E2BSandboxOptions) {
    this.factory = opts.factory
    this.domain = opts.e2bDomain
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 30_000
    this.maxStdoutBytes = opts.maxStdoutBytes ?? 64 * 1024
    this.onLog = opts.onLog
    this.tier = this.domain === undefined ? 'vm-managed' : 'vm-self-hosted'
    this.threatBoundary = {
      trustedCallers: ['agent-loop'],
      observesSecrets: false,
      egressDomains: opts.allowedEgressDomains ?? 'none',
      readsFilesystem: true,
      writesFilesystem: true,
    }
  }

  async exec(input: SandboxExecInput, ctx: Ctx<unknown>): Promise<SandboxExecOutput> {
    const tenant = String(ctx.tenant)
    const runId = String(ctx.runId)
    const client = await this.getClient(tenant, runId)

    const started = Date.now()
    const timeoutMs = input.timeoutMs ?? this.defaultTimeoutMs

    const onStdout = this.onLog
      ? (chunk: string): void => this.onLog!({ tenant, runId, stream: 'stdout', chunk })
      : undefined
    const onStderr = this.onLog
      ? (chunk: string): void => this.onLog!({ tenant, runId, stream: 'stderr', chunk })
      : undefined

    const runOpts: {
      stdin?: string
      timeoutMs: number
      env?: Readonly<Record<string, string>>
      onStdout?: (c: string) => void
      onStderr?: (c: string) => void
    } = { timeoutMs }
    if (input.stdin !== undefined) runOpts.stdin = input.stdin
    if (input.env !== undefined) runOpts.env = input.env
    if (onStdout !== undefined) runOpts.onStdout = onStdout
    if (onStderr !== undefined) runOpts.onStderr = onStderr

    let result
    try {
      result = await client.run(input.command, runOpts)
    } catch (err) {
      const elapsed = Date.now() - started
      const message = err instanceof Error ? err.message : String(err)
      const isTimeout = /timeout/i.test(message)
      return {
        stdout: '',
        stderr: message,
        exitCode: isTimeout ? 124 : 1,
        durationMs: elapsed,
        tier: this.tier,
        truncated: false,
      }
    }

    const elapsed = Date.now() - started
    const truncatedStdout = result.stdout.length > this.maxStdoutBytes
    const truncatedStderr = result.stderr.length > this.maxStdoutBytes
    return {
      stdout: truncatedStdout ? result.stdout.slice(0, this.maxStdoutBytes) : result.stdout,
      stderr: truncatedStderr ? result.stderr.slice(0, this.maxStdoutBytes) : result.stderr,
      exitCode: result.exitCode,
      durationMs: elapsed,
      tier: this.tier,
      truncated: truncatedStdout || truncatedStderr,
    }
  }

  async dispose(): Promise<void> {
    const pending = [...this.clients.values()]
    this.clients.clear()
    await Promise.all(
      pending.map(async (p) => {
        try {
          const c = await p
          await c.kill()
        } catch {
          /* swallow — dispose is best-effort */
        }
      }),
    )
  }

  private getClient(tenant: string, runId: string): Promise<E2BClient> {
    const key = sandboxKey(tenant, runId)
    const existing = this.clients.get(key)
    if (existing !== undefined) return existing

    const input: { tenant: string; runId: string; domain?: string; timeoutMs?: number } = {
      tenant,
      runId,
      timeoutMs: this.defaultTimeoutMs,
    }
    if (this.domain !== undefined) input.domain = this.domain

    const created = this.factory.create(input)
    this.clients.set(key, created)
    return created
  }
}
