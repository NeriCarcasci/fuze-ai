import type { Ctx } from '@fuze-ai/agent'
import type {
  FuzeSandbox,
  SandboxExecInput,
  SandboxExecOutput,
} from '@fuze-ai/agent'
import { SandboxRefusedError } from '@fuze-ai/agent'
import { SimpleTenantWatchdog, type TenantWatchdog } from '@fuze-ai/agent'
import type { ThreatBoundary } from '@fuze-ai/agent'
import type {
  BashFactory,
  BashFetchEntry,
  BashInstance,
  BashLogEntry,
} from './types.js'

export interface JustBashSandboxOptions {
  readonly factory: BashFactory
  readonly tenantWatchdog?: TenantWatchdog
  readonly allowedFetchPrefixes?: readonly string[]
  readonly onLog?: (entry: BashLogEntry) => void
  readonly onFetch?: (entry: BashFetchEntry) => void
  readonly defaultTimeoutMs?: number
  readonly maxStdoutBytes?: number
  readonly initialCwd?: string
  readonly initialEnv?: Readonly<Record<string, string>>
  readonly initialFiles?: Readonly<Record<string, string>>
}

const HOUR_MS = 60 * 60 * 1000

interface InstanceKey {
  readonly tenant: string
  readonly runId: string
}

const keyOf = (k: InstanceKey): string => `${k.tenant}::${k.runId}`

export class JustBashSandbox implements FuzeSandbox {
  readonly tier = 'in-process' as const
  readonly threatBoundary: ThreatBoundary

  private readonly factory: BashFactory
  private readonly watchdog: TenantWatchdog
  private readonly onLog: ((entry: BashLogEntry) => void) | undefined
  private readonly onFetch: ((entry: BashFetchEntry) => void) | undefined
  private readonly defaultTimeoutMs: number
  private readonly maxStdoutBytes: number
  private readonly allowedFetchPrefixes: readonly string[]
  private readonly initialCwd: string | undefined
  private readonly initialEnv: Readonly<Record<string, string>> | undefined
  private readonly initialFiles: Readonly<Record<string, string>> | undefined

  private readonly instances = new Map<string, BashInstance>()

  constructor(opts: JustBashSandboxOptions) {
    this.factory = opts.factory
    this.watchdog = opts.tenantWatchdog ?? new SimpleTenantWatchdog()
    this.onLog = opts.onLog
    this.onFetch = opts.onFetch
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 5_000
    this.maxStdoutBytes = opts.maxStdoutBytes ?? 32 * 1024
    this.allowedFetchPrefixes = opts.allowedFetchPrefixes ?? []
    this.initialCwd = opts.initialCwd
    this.initialEnv = opts.initialEnv
    this.initialFiles = opts.initialFiles

    this.threatBoundary = {
      trustedCallers: ['agent-loop'],
      observesSecrets: true,
      egressDomains:
        this.allowedFetchPrefixes.length === 0
          ? 'none'
          : [...this.allowedFetchPrefixes],
      readsFilesystem: true,
      writesFilesystem: true,
    }
  }

  async exec(input: SandboxExecInput, ctx: Ctx<unknown>): Promise<SandboxExecOutput> {
    this.watchdog.observe(ctx.tenant)
    if (this.watchdog.recentTenantCount(HOUR_MS) > 1) {
      throw new SandboxRefusedError(
        'just-bash sandbox requires single-tenant deployment; use vm-managed or vm-self-hosted',
      )
    }

    const bash = this.getOrCreate({ tenant: ctx.tenant, runId: ctx.runId })
    const timeoutMs = input.timeoutMs ?? this.defaultTimeoutMs

    const started = Date.now()
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)

    const execOpts: { stdin?: string; env?: Readonly<Record<string, string>>; signal: AbortSignal } = {
      signal: controller.signal,
    }
    if (input.stdin !== undefined) execOpts.stdin = input.stdin
    if (input.env !== undefined) execOpts.env = input.env

    let result: { stdout: string; stderr: string; exitCode: number }
    try {
      const execPromise = bash.exec(input.command, execOpts).then(
        (r) => ({ ok: true as const, value: r }),
        (e: unknown) => ({ ok: false as const, error: e }),
      )
      const timeoutPromise = new Promise<{ ok: false; error: unknown }>((resolve) => {
        controller.signal.addEventListener('abort', () =>
          resolve({ ok: false, error: new Error('timeout') }),
        )
      })
      const settled = await Promise.race([execPromise, timeoutPromise])
      if (settled.ok) {
        result = settled.value
      } else if (timedOut) {
        result = { stdout: '', stderr: `timeout after ${timeoutMs}ms`, exitCode: 124 }
      } else {
        throw settled.error
      }
    } finally {
      clearTimeout(timer)
    }

    const durationMs = Date.now() - started

    if (this.onLog) {
      this.onLog({
        command: input.command,
        exitCode: result.exitCode,
        durationMs,
        tenant: ctx.tenant,
        runId: ctx.runId,
      })
    }

    const truncatedStdout = result.stdout.length > this.maxStdoutBytes
    const truncatedStderr = result.stderr.length > this.maxStdoutBytes

    return {
      stdout: truncatedStdout ? result.stdout.slice(0, this.maxStdoutBytes) : result.stdout,
      stderr: truncatedStderr ? result.stderr.slice(0, this.maxStdoutBytes) : result.stderr,
      exitCode: timedOut ? 124 : result.exitCode,
      durationMs,
      tier: this.tier,
      truncated: truncatedStdout || truncatedStderr,
    }
  }

  async dispose(): Promise<void> {
    this.instances.clear()
  }

  private getOrCreate(key: InstanceKey): BashInstance {
    const k = keyOf(key)
    const existing = this.instances.get(k)
    if (existing) return existing

    const wrappedFetch = this.buildFetch(key)
    const createOpts: Parameters<BashFactory['create']>[0] = {
      logger: () => {
        // per-command logger forwarding handled in exec for full ctx access
      },
    }
    if (this.initialCwd !== undefined) Object.assign(createOpts, { cwd: this.initialCwd })
    if (this.initialEnv !== undefined) Object.assign(createOpts, { env: this.initialEnv })
    if (this.initialFiles !== undefined) Object.assign(createOpts, { files: this.initialFiles })
    if (wrappedFetch !== undefined) Object.assign(createOpts, { fetch: wrappedFetch })

    const instance = this.factory.create(createOpts)
    this.instances.set(k, instance)
    return instance
  }

  private buildFetch(
    key: InstanceKey,
  ): ((url: string, init?: { method?: string }) => Promise<Response>) | undefined {
    if (this.onFetch === undefined && this.allowedFetchPrefixes.length === 0) {
      return undefined
    }
    const onFetch = this.onFetch
    const prefixes = this.allowedFetchPrefixes
    return async (url: string, init?: { method?: string }): Promise<Response> => {
      const method = init?.method ?? 'GET'
      if (onFetch) {
        onFetch({ url, method, tenant: key.tenant, runId: key.runId })
      }
      if (prefixes.length > 0 && !prefixes.some((p) => url.startsWith(p))) {
        throw new Error(`fetch denied: ${url} not in allowedFetchPrefixes`)
      }
      return fetch(url, init)
    }
  }
}
