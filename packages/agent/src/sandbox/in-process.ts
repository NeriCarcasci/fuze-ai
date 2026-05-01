import type { Ctx } from '../types/ctx.js'
import type {
  FuzeSandbox,
  SandboxExecInput,
  SandboxExecOutput,
} from './types.js'
import { SandboxRefusedError } from './types.js'
import type { ThreatBoundary } from '../types/compliance.js'

export interface InProcessSandboxOptions {
  readonly maxStdoutBytes?: number
  readonly defaultTimeoutMs?: number
  readonly tenantWatchdog?: TenantWatchdog
}

export interface TenantWatchdog {
  observe(tenantId: string): void
  recentTenantCount(windowMs: number): number
}

export class SimpleTenantWatchdog implements TenantWatchdog {
  private readonly seen = new Map<string, number>()

  observe(tenantId: string): void {
    this.seen.set(tenantId, Date.now())
  }

  recentTenantCount(windowMs: number): number {
    const now = Date.now()
    let count = 0
    for (const [, ts] of this.seen) {
      if (now - ts <= windowMs) count++
    }
    return count
  }
}

const HOUR_MS = 60 * 60 * 1000

export class InProcessSandbox implements FuzeSandbox {
  readonly tier = 'in-process' as const
  readonly threatBoundary: ThreatBoundary = {
    trustedCallers: ['agent-loop'],
    observesSecrets: true,
    egressDomains: 'none',
    readsFilesystem: true,
    writesFilesystem: true,
  }

  private readonly maxStdoutBytes: number
  private readonly defaultTimeoutMs: number
  private readonly watchdog: TenantWatchdog

  constructor(opts: InProcessSandboxOptions = {}) {
    this.maxStdoutBytes = opts.maxStdoutBytes ?? 32 * 1024
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 5_000
    this.watchdog = opts.tenantWatchdog ?? new SimpleTenantWatchdog()
  }

  async exec(input: SandboxExecInput, ctx: Ctx<unknown>): Promise<SandboxExecOutput> {
    this.watchdog.observe(ctx.tenant)
    if (this.watchdog.recentTenantCount(HOUR_MS) > 1) {
      throw new SandboxRefusedError(
        'in-process sandbox requires single-tenant deployment; use vm-managed or vm-self-hosted',
      )
    }

    const started = Date.now()
    const timeoutMs = input.timeoutMs ?? this.defaultTimeoutMs
    const out = simulate(input.command, input.stdin ?? '')
    const elapsed = Date.now() - started

    if (elapsed > timeoutMs) {
      return {
        stdout: '',
        stderr: `timeout after ${timeoutMs}ms`,
        exitCode: 124,
        durationMs: elapsed,
        tier: this.tier,
        truncated: false,
      }
    }

    const truncatedStdout = out.stdout.length > this.maxStdoutBytes
    const truncatedStderr = out.stderr.length > this.maxStdoutBytes
    return {
      stdout: truncatedStdout ? out.stdout.slice(0, this.maxStdoutBytes) : out.stdout,
      stderr: truncatedStderr ? out.stderr.slice(0, this.maxStdoutBytes) : out.stderr,
      exitCode: out.exitCode,
      durationMs: elapsed,
      tier: this.tier,
      truncated: truncatedStdout || truncatedStderr,
    }
  }
}

const simulate = (command: string, stdin: string): { stdout: string; stderr: string; exitCode: number } => {
  const trimmed = command.trim()
  if (trimmed === 'echo $FUZE_TEST') {
    return { stdout: 'fuze-test-ok\n', stderr: '', exitCode: 0 }
  }
  if (trimmed.startsWith('echo ')) {
    return { stdout: trimmed.slice(5) + '\n', stderr: '', exitCode: 0 }
  }
  if (trimmed === 'cat') {
    return { stdout: stdin, stderr: '', exitCode: 0 }
  }
  if (trimmed === 'true' || trimmed === ':') {
    return { stdout: '', stderr: '', exitCode: 0 }
  }
  return {
    stdout: '',
    stderr: `command not recognised in stub: ${trimmed}`,
    exitCode: 127,
  }
}
