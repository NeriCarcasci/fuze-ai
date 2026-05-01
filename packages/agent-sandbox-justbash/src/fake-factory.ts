import type {
  BashCreateOptions,
  BashExecOptions,
  BashExecResult,
  BashFactory,
  BashInstance,
} from './types.js'

class FakeBash implements BashInstance {
  private cwd: string
  private readonly env: Record<string, string>
  private readonly files: Record<string, string>
  private readonly logger: BashCreateOptions['logger']

  constructor(opts: BashCreateOptions) {
    this.cwd = opts.cwd ?? '/'
    this.env = { ...(opts.env ?? {}) }
    this.files = { ...(opts.files ?? {}) }
    this.logger = opts.logger
  }

  async exec(command: string, opts: BashExecOptions = {}): Promise<BashExecResult> {
    const started = Date.now()
    const result = this.run(command, opts)
    const durationMs = Date.now() - started
    if (this.logger) {
      this.logger({ command, exitCode: result.exitCode, durationMs })
    }
    return result
  }

  private run(command: string, opts: BashExecOptions): BashExecResult {
    const trimmed = command.trim()

    if (trimmed.startsWith('echo ')) {
      return { stdout: trimmed.slice(5) + '\n', stderr: '', exitCode: 0 }
    }
    if (trimmed === 'cat') {
      return { stdout: opts.stdin ?? '', stderr: '', exitCode: 0 }
    }
    if (trimmed === 'pwd') {
      return { stdout: this.cwd + '\n', stderr: '', exitCode: 0 }
    }
    if (trimmed.startsWith('cd ')) {
      this.cwd = trimmed.slice(3).trim()
      return { stdout: '', stderr: '', exitCode: 0 }
    }
    if (trimmed.startsWith('export ')) {
      const rest = trimmed.slice(7)
      const eq = rest.indexOf('=')
      if (eq > 0) {
        const key = rest.slice(0, eq)
        const value = rest.slice(eq + 1)
        this.env[key] = value
      }
      return { stdout: '', stderr: '', exitCode: 0 }
    }
    if (trimmed.startsWith('printenv ')) {
      const key = trimmed.slice(9).trim()
      const v = this.env[key]
      if (v === undefined) return { stdout: '', stderr: '', exitCode: 1 }
      return { stdout: v + '\n', stderr: '', exitCode: 0 }
    }
    if (trimmed === 'true' || trimmed === ':') {
      return { stdout: '', stderr: '', exitCode: 0 }
    }
    if (trimmed === 'false') {
      return { stdout: '', stderr: '', exitCode: 1 }
    }
    if (trimmed.startsWith('sleep ')) {
      return { stdout: '', stderr: '', exitCode: 0 }
    }
    if (trimmed.startsWith('write ')) {
      const rest = trimmed.slice(6)
      const sp = rest.indexOf(' ')
      if (sp > 0) {
        const path = rest.slice(0, sp)
        const content = rest.slice(sp + 1)
        this.files[path] = content
      }
      return { stdout: '', stderr: '', exitCode: 0 }
    }
    if (trimmed.startsWith('read ')) {
      const path = trimmed.slice(5).trim()
      const content = this.files[path]
      if (content === undefined) {
        return { stdout: '', stderr: `no such file: ${path}`, exitCode: 1 }
      }
      return { stdout: content, stderr: '', exitCode: 0 }
    }
    if (trimmed.startsWith('__sleep_real ')) {
      const ms = Number(trimmed.slice(13).trim())
      const start = Date.now()
      while (Date.now() - start < ms) {
        // busy-wait so timeout logic in adapter trips; small ms only used in tests
      }
      return { stdout: '', stderr: '', exitCode: 0 }
    }
    return {
      stdout: '',
      stderr: `command not recognised in fake: ${trimmed}`,
      exitCode: 127,
    }
  }
}

export class FakeBashFactory implements BashFactory {
  create(opts: BashCreateOptions): BashInstance {
    return new FakeBash(opts)
  }
}
