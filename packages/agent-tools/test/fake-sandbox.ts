import type {
  Ctx,
  FuzeSandbox,
  RetentionPolicy,
  SandboxExecInput,
  SandboxExecOutput,
  SandboxTier,
  ThreatBoundary,
} from '@fuze-ai/agent'
import {
  buildCtx,
  inMemorySecrets,
  makePrincipalId,
  makeRunId,
  makeStepId,
  makeTenantId,
} from '@fuze-ai/agent'

export interface FakeSandboxOptions {
  readonly httpResponses?: Readonly<Record<string, { status: number; body: string; headers?: Record<string, string> }>>
  readonly tier?: SandboxTier
}

export const TEST_RETENTION: RetentionPolicy = {
  id: 'test.v1',
  hashTtlDays: 30,
  fullContentTtlDays: 7,
  decisionTtlDays: 90,
}

export class FakeSandbox implements FuzeSandbox {
  readonly tier: SandboxTier
  readonly threatBoundary: ThreatBoundary = {
    trustedCallers: ['agent-loop'],
    observesSecrets: false,
    egressDomains: 'none',
    readsFilesystem: true,
    writesFilesystem: true,
  }

  readonly fs = new Map<string, string>()
  readonly calls: SandboxExecInput[] = []
  private readonly httpResponses: Readonly<
    Record<string, { status: number; body: string; headers?: Record<string, string> }>
  >

  constructor(opts: FakeSandboxOptions = {}) {
    this.tier = opts.tier ?? 'in-process'
    this.httpResponses = opts.httpResponses ?? {}
  }

  async exec(input: SandboxExecInput, _ctx: Ctx<unknown>): Promise<SandboxExecOutput> {
    this.calls.push(input)
    const cmd = input.command
    const start = 0

    if (cmd.startsWith('echo ')) {
      const text = cmd.slice('echo '.length)
      return this.makeOutput({ stdout: text, exitCode: 0 })
    }

    if (cmd === 'cat-stdin') {
      return this.makeOutput({ stdout: input.stdin ?? '', exitCode: 0 })
    }

    if (cmd === 'fail') {
      return this.makeOutput({ stdout: '', stderr: 'boom', exitCode: 1 })
    }

    if (cmd.startsWith('fetch ')) {
      const url = cmd.slice('fetch '.length)
      const resp = this.httpResponses[url]
      if (!resp) {
        return this.makeOutput({ stdout: '', stderr: `no fixture: ${url}`, exitCode: 1 })
      }
      const envelope = {
        status: resp.status,
        body: resp.body,
        headers: resp.headers ?? {},
      }
      return this.makeOutput({ stdout: JSON.stringify(envelope), exitCode: 0 })
    }

    if (cmd.startsWith('read_file ')) {
      const path = cmd.slice('read_file '.length)
      const value = this.fs.get(path)
      if (value === undefined) {
        return this.makeOutput({ stdout: '', stderr: `no such file: ${path}`, exitCode: 1 })
      }
      return this.makeOutput({ stdout: value, exitCode: 0 })
    }

    if (cmd.startsWith('write_file ')) {
      const path = cmd.slice('write_file '.length)
      const content = input.stdin ?? ''
      this.fs.set(path, content)
      return this.makeOutput({ stdout: String(Buffer.byteLength(content, 'utf8')), exitCode: 0 })
    }

    if (cmd.startsWith('list_files ')) {
      const dir = cmd.slice('list_files '.length)
      const prefix = dir.endsWith('/') ? dir : `${dir}/`
      const entries: string[] = []
      for (const path of this.fs.keys()) {
        if (path.startsWith(prefix)) {
          entries.push(path.slice(prefix.length))
        }
      }
      return this.makeOutput({ stdout: entries.join('\n'), exitCode: 0 })
    }

    return this.makeOutput({ stdout: '', stderr: `unknown command: ${cmd}`, exitCode: 127 })

    void start
  }

  private makeOutput(partial: {
    stdout?: string
    stderr?: string
    exitCode: number
  }): SandboxExecOutput {
    return {
      stdout: partial.stdout ?? '',
      stderr: partial.stderr ?? '',
      exitCode: partial.exitCode,
      durationMs: 1,
      tier: this.tier,
      truncated: false,
    }
  }
}

export const makeTestCtx = (): Ctx<unknown> =>
  buildCtx<unknown>({
    tenant: makeTenantId('test-tenant'),
    principal: makePrincipalId('test-principal'),
    runId: makeRunId('run-1'),
    stepId: makeStepId('step-1'),
    deps: {},
    secrets: inMemorySecrets({}),
    attribute: () => {},
    invoke: async <_TIn, TOut>() => ({}) as TOut,
  })
