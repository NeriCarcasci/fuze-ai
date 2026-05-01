import type {
  E2BClient,
  E2BClientFactory,
  E2BClientFactoryInput,
  E2BCommandResult,
  E2BRunOptions,
} from './types.js'

export class E2BNotInstalledError extends Error {
  constructor(cause?: unknown) {
    super('e2b is not installed. Install it with `npm install e2b` to use RealE2BClientFactory.')
    this.name = 'E2BNotInstalledError'
    if (cause !== undefined) {
      ;(this as { cause?: unknown }).cause = cause
    }
  }
}

export interface RealE2BClientFactoryOptions {
  readonly apiKey?: string
}

interface UpstreamSandbox {
  commands: {
    run(
      command: string,
      opts?: {
        stdin?: string
        timeoutMs?: number
        envs?: Readonly<Record<string, string>>
        onStdout?: (chunk: string) => void
        onStderr?: (chunk: string) => void
      },
    ): Promise<{ stdout: string; stderr: string; exitCode: number }>
  }
  pause(): Promise<string>
  kill(): Promise<void>
}

interface UpstreamSandboxStatic {
  create(opts: {
    apiKey?: string
    timeoutMs?: number
    domain?: string
  }): Promise<UpstreamSandbox>
  resume(
    id: string,
    opts: { apiKey?: string; timeoutMs?: number; domain?: string },
  ): Promise<UpstreamSandbox>
}

interface UpstreamModule {
  Sandbox: UpstreamSandboxStatic
}

class RealE2BClient implements E2BClient {
  constructor(private readonly upstream: UpstreamSandbox) {}

  async run(command: string, opts?: E2BRunOptions): Promise<E2BCommandResult> {
    const upstreamOpts: {
      stdin?: string
      timeoutMs?: number
      envs?: Readonly<Record<string, string>>
      onStdout?: (chunk: string) => void
      onStderr?: (chunk: string) => void
    } = {}
    if (opts?.stdin !== undefined) upstreamOpts.stdin = opts.stdin
    if (opts?.timeoutMs !== undefined) upstreamOpts.timeoutMs = opts.timeoutMs
    if (opts?.env !== undefined) upstreamOpts.envs = opts.env
    if (opts?.onStdout !== undefined) upstreamOpts.onStdout = opts.onStdout
    if (opts?.onStderr !== undefined) upstreamOpts.onStderr = opts.onStderr
    const r = await this.upstream.commands.run(command, upstreamOpts)
    return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }
  }

  async pause(): Promise<string> {
    return this.upstream.pause()
  }

  async kill(): Promise<void> {
    await this.upstream.kill()
  }
}

export class RealE2BClientFactory implements E2BClientFactory {
  private readonly apiKey: string | undefined

  constructor(opts: RealE2BClientFactoryOptions = {}) {
    this.apiKey = opts.apiKey
  }

  async create(input: E2BClientFactoryInput): Promise<E2BClient> {
    const upstream = await loadUpstream()
    const createOpts: { apiKey?: string; timeoutMs?: number; domain?: string } = {}
    if (this.apiKey !== undefined) createOpts.apiKey = this.apiKey
    if (input.timeoutMs !== undefined) createOpts.timeoutMs = input.timeoutMs
    if (input.domain !== undefined) createOpts.domain = input.domain
    const sandbox = await upstream.Sandbox.create(createOpts)
    return new RealE2BClient(sandbox)
  }

  async resume(id: string, input: E2BClientFactoryInput): Promise<E2BClient> {
    const upstream = await loadUpstream()
    const resumeOpts: { apiKey?: string; timeoutMs?: number; domain?: string } = {}
    if (this.apiKey !== undefined) resumeOpts.apiKey = this.apiKey
    if (input.timeoutMs !== undefined) resumeOpts.timeoutMs = input.timeoutMs
    if (input.domain !== undefined) resumeOpts.domain = input.domain
    const sandbox = await upstream.Sandbox.resume(id, resumeOpts)
    return new RealE2BClient(sandbox)
  }
}

async function loadUpstream(): Promise<UpstreamModule> {
  try {
    const specifier: string = 'e2b'
    const mod = (await import(specifier)) as unknown as UpstreamModule
    return mod
  } catch (err) {
    throw new E2BNotInstalledError(err)
  }
}
