import type {
  E2BClient,
  E2BClientFactory,
  E2BClientFactoryInput,
  E2BCommandResult,
  E2BRunOptions,
} from './types.js'

export interface FakeE2BClientOptions {
  readonly id: string
  readonly slowMs?: number
}

export class FakeE2BClient implements E2BClient {
  readonly id: string
  killed = false
  paused = false
  runs: Array<{ command: string; opts: E2BRunOptions | undefined }> = []
  private readonly slowMs: number

  constructor(opts: FakeE2BClientOptions) {
    this.id = opts.id
    this.slowMs = opts.slowMs ?? 0
  }

  async run(command: string, opts?: E2BRunOptions): Promise<E2BCommandResult> {
    if (this.killed) throw new Error('sandbox already killed')
    this.runs.push({ command, opts })

    if (this.slowMs > 0) {
      const timeoutMs = opts?.timeoutMs ?? Infinity
      if (this.slowMs > timeoutMs) {
        await sleep(timeoutMs)
        throw new Error(`command timeout after ${timeoutMs}ms`)
      }
      await sleep(this.slowMs)
    }

    const trimmed = command.trim()
    if (trimmed.startsWith('echo ')) {
      const out = trimmed.slice(5)
      opts?.onStdout?.(out + '\n')
      return { stdout: out + '\n', stderr: '', exitCode: 0 }
    }
    if (trimmed === 'cat') {
      const stdin = opts?.stdin ?? ''
      opts?.onStdout?.(stdin)
      return { stdout: stdin, stderr: '', exitCode: 0 }
    }
    if (trimmed === 'true' || trimmed === ':') {
      return { stdout: '', stderr: '', exitCode: 0 }
    }
    if (trimmed.startsWith('env ')) {
      const key = trimmed.slice(4).trim()
      const value = opts?.env?.[key] ?? ''
      opts?.onStdout?.(value + '\n')
      return { stdout: value + '\n', stderr: '', exitCode: 0 }
    }
    const stderr = `fake-e2b: command not recognised: ${trimmed}`
    opts?.onStderr?.(stderr)
    return { stdout: '', stderr, exitCode: 127 }
  }

  async pause(): Promise<string> {
    this.paused = true
    return `paused-${this.id}`
  }

  async kill(): Promise<void> {
    this.killed = true
  }
}

export class FakeE2BClientFactory implements E2BClientFactory {
  readonly created: FakeE2BClient[] = []
  private counter = 0
  private readonly slowMs: number

  constructor(opts: { slowMs?: number } = {}) {
    this.slowMs = opts.slowMs ?? 0
  }

  async create(input: E2BClientFactoryInput): Promise<E2BClient> {
    const c = new FakeE2BClient({
      id: `fake-${input.tenant}-${input.runId}-${++this.counter}`,
      slowMs: this.slowMs,
    })
    this.created.push(c)
    return c
  }

  async resume(id: string, _input: E2BClientFactoryInput): Promise<E2BClient> {
    const c = new FakeE2BClient({ id: `resumed-${id}-${++this.counter}` })
    this.created.push(c)
    return c
  }
}

const sleep = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms))
