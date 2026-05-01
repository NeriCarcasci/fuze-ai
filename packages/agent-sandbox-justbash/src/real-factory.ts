import { createRequire } from 'node:module'
import type {
  BashCreateOptions,
  BashExecOptions,
  BashExecResult,
  BashFactory,
  BashInstance,
} from './types.js'

export class JustBashNotInstalledError extends Error {
  constructor(cause?: unknown) {
    super(
      'just-bash is not installed. Install it with `npm install just-bash` to use RealBashFactory.',
    )
    this.name = 'JustBashNotInstalledError'
    if (cause !== undefined) {
      ;(this as { cause?: unknown }).cause = cause
    }
  }
}

interface UpstreamBashLogger {
  info(message: string, data?: Record<string, unknown>): void
  debug(message: string, data?: Record<string, unknown>): void
}

interface UpstreamBashCtor {
  new (opts: {
    cwd?: string
    env?: Readonly<Record<string, string>>
    files?: Readonly<Record<string, string>>
    logger?: UpstreamBashLogger
    fetch?: (url: string, init?: { method?: string }) => Promise<Response>
  }): UpstreamBash
}

interface UpstreamBash {
  exec(
    command: string,
    opts?: {
      stdin?: string
      env?: Readonly<Record<string, string>>
      cwd?: string
      signal?: AbortSignal
    },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>
}

interface UpstreamModule {
  Bash: UpstreamBashCtor
}

class RealBashAdapter implements BashInstance {
  constructor(private readonly upstream: UpstreamBash) {}

  async exec(command: string, opts: BashExecOptions = {}): Promise<BashExecResult> {
    const upstreamOpts: {
      stdin?: string
      env?: Readonly<Record<string, string>>
      cwd?: string
      signal?: AbortSignal
    } = {}
    if (opts.stdin !== undefined) upstreamOpts.stdin = opts.stdin
    if (opts.env !== undefined) upstreamOpts.env = opts.env
    if (opts.cwd !== undefined) upstreamOpts.cwd = opts.cwd
    if (opts.signal !== undefined) upstreamOpts.signal = opts.signal
    const r = await this.upstream.exec(command, upstreamOpts)
    return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }
  }
}

const adaptLogger = (
  fn: (event: { command: string; exitCode: number; durationMs: number }) => void,
): UpstreamBashLogger => {
  const noop = (): void => undefined
  // The upstream logger receives free-form info/debug strings; we forward only
  // structured exec-completion events to the BashLoggerEvent contract.
  return {
    info: (_message, data) => {
      if (data === undefined) return
      const command = typeof data['command'] === 'string' ? (data['command'] as string) : undefined
      const exitCode = typeof data['exitCode'] === 'number' ? (data['exitCode'] as number) : undefined
      const durationMs =
        typeof data['durationMs'] === 'number' ? (data['durationMs'] as number) : undefined
      if (command !== undefined && exitCode !== undefined && durationMs !== undefined) {
        fn({ command, exitCode, durationMs })
      }
    },
    debug: noop,
  }
}

export const __testing__ = { adaptLogger }

export class RealBashFactory implements BashFactory {
  create(opts: BashCreateOptions): BashInstance {
    const upstream = loadUpstream()
    const ctorOpts: {
      cwd?: string
      env?: Readonly<Record<string, string>>
      files?: Readonly<Record<string, string>>
      logger?: UpstreamBashLogger
      fetch?: (url: string, init?: { method?: string }) => Promise<Response>
    } = {}
    if (opts.cwd !== undefined) ctorOpts.cwd = opts.cwd
    if (opts.env !== undefined) ctorOpts.env = opts.env
    if (opts.files !== undefined) ctorOpts.files = opts.files
    if (opts.logger !== undefined) ctorOpts.logger = adaptLogger(opts.logger)
    if (opts.fetch !== undefined) ctorOpts.fetch = opts.fetch
    const instance = new upstream.Bash(ctorOpts)
    return new RealBashAdapter(instance)
  }
}

function loadUpstream(): UpstreamModule {
  try {
    const req = createRequire(import.meta.url)
    return req('just-bash') as UpstreamModule
  } catch (err) {
    throw new JustBashNotInstalledError(err)
  }
}
