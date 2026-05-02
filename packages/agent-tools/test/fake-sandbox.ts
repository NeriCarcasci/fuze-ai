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

export interface FakeFetchCall {
  readonly url: string
  readonly method: string
  readonly headers: Record<string, string>
  readonly body: string | undefined
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
  readonly fetchCalls: FakeFetchCall[] = []
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
      this.fetchCalls.push({ url, method: 'GET', headers: {}, body: undefined })
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

    if (cmd === 'fetch') {
      return this.handleFetchStdin(input.stdin ?? '')
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

    if (cmd === 'grep') {
      return this.handleGrep(input.stdin ?? '')
    }

    if (cmd === 'glob') {
      return this.handleGlob(input.stdin ?? '')
    }

    if (cmd === 'edit') {
      return this.handleEdit(input.stdin ?? '')
    }

    if (cmd === 'bash_stream') {
      return this.handleBashStream(input.stdin ?? '')
    }

    return this.makeOutput({ stdout: '', stderr: `unknown command: ${cmd}`, exitCode: 127 })

    void start
  }

  private handleFetchStdin(stdin: string): SandboxExecOutput {
    let args: { url?: unknown; method?: unknown; headers?: unknown; body?: unknown }
    try {
      args = JSON.parse(stdin) as typeof args
    } catch {
      return this.makeOutput({ stdout: '', stderr: 'fetch-bad-stdin', exitCode: 2 })
    }
    if (typeof args.url !== 'string') {
      return this.makeOutput({ stdout: '', stderr: 'fetch-missing-url', exitCode: 2 })
    }
    const method =
      typeof args.method === 'string' && args.method.length > 0 ? args.method : 'GET'
    const headers: Record<string, string> = {}
    if (args.headers && typeof args.headers === 'object') {
      for (const [k, v] of Object.entries(args.headers as Record<string, unknown>)) {
        if (typeof v === 'string') headers[k] = v
      }
    }
    const body = typeof args.body === 'string' ? args.body : undefined
    this.fetchCalls.push({ url: args.url, method, headers, body })
    const resp = this.httpResponses[args.url]
    if (!resp) {
      return this.makeOutput({ stdout: '', stderr: `no fixture: ${args.url}`, exitCode: 1 })
    }
    const envelope = {
      status: resp.status,
      body: resp.body,
      headers: resp.headers ?? {},
    }
    return this.makeOutput({ stdout: JSON.stringify(envelope), exitCode: 0 })
  }

  private handleGrep(stdin: string): SandboxExecOutput {
    let args: {
      pattern?: unknown
      path?: unknown
      glob?: unknown
      caseInsensitive?: unknown
      maxMatches?: unknown
    }
    try {
      args = JSON.parse(stdin) as typeof args
    } catch {
      return this.makeOutput({ stdout: '', stderr: 'grep-bad-stdin', exitCode: 2 })
    }
    if (typeof args.pattern !== 'string' || typeof args.path !== 'string') {
      return this.makeOutput({ stdout: '', stderr: 'grep-missing-args', exitCode: 2 })
    }
    let regex: RegExp
    try {
      regex = new RegExp(args.pattern, args.caseInsensitive === true ? 'i' : undefined)
    } catch (err) {
      return this.makeOutput({
        stdout: '',
        stderr: `grep-invalid-pattern:${(err as Error).message}`,
        exitCode: 2,
      })
    }
    const pathPrefix = args.path.endsWith('/') ? args.path : `${args.path}/`
    const includeRoot = args.path
    const globMatcher =
      typeof args.glob === 'string' ? makeGlobMatcher(args.glob) : null
    const max =
      typeof args.maxMatches === 'number' && Number.isInteger(args.maxMatches) && args.maxMatches > 0
        ? args.maxMatches
        : 1000
    const matches: Array<{ path: string; line: number; text: string }> = []
    let truncated = false
    for (const [path, content] of this.fs.entries()) {
      const inScope = path === includeRoot || path.startsWith(pathPrefix)
      if (!inScope) continue
      if (globMatcher && !globMatcher(path)) continue
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const lineText = lines[i] ?? ''
        if (regex.test(lineText)) {
          if (matches.length >= max) {
            truncated = true
            break
          }
          matches.push({ path, line: i + 1, text: lineText })
        }
      }
      if (truncated) break
    }
    return this.makeOutput({
      stdout: JSON.stringify({ matches, truncated }),
      exitCode: 0,
    })
  }

  private handleGlob(stdin: string): SandboxExecOutput {
    let args: { pattern?: unknown; path?: unknown; maxResults?: unknown }
    try {
      args = JSON.parse(stdin) as typeof args
    } catch {
      return this.makeOutput({ stdout: '', stderr: 'glob-bad-stdin', exitCode: 2 })
    }
    if (typeof args.pattern !== 'string') {
      return this.makeOutput({ stdout: '', stderr: 'glob-missing-args', exitCode: 2 })
    }
    const max =
      typeof args.maxResults === 'number' && Number.isInteger(args.maxResults) && args.maxResults > 0
        ? args.maxResults
        : 10_000
    const root = typeof args.path === 'string' ? args.path : ''
    const rootPrefix = root === '' ? '' : root.endsWith('/') ? root : `${root}/`
    const matcher = makeGlobMatcher(args.pattern)
    const paths: string[] = []
    let truncated = false
    for (const path of this.fs.keys()) {
      if (rootPrefix !== '' && !path.startsWith(rootPrefix) && path !== root) continue
      const rel = rootPrefix === '' ? path : path.slice(rootPrefix.length)
      if (matcher(rel)) {
        if (paths.length >= max) {
          truncated = true
          break
        }
        paths.push(path)
      }
    }
    return this.makeOutput({
      stdout: JSON.stringify({ paths, truncated }),
      exitCode: 0,
    })
  }

  private handleBashStream(stdin: string): SandboxExecOutput {
    let args: { command?: unknown; stdin?: unknown }
    try {
      args = JSON.parse(stdin) as typeof args
    } catch {
      return this.makeOutput({ stdout: '', stderr: 'bash_stream-bad-stdin', exitCode: 2 })
    }
    if (typeof args.command !== 'string') {
      return this.makeOutput({ stdout: '', stderr: 'bash_stream-missing-command', exitCode: 2 })
    }
    const cmd = args.command
    if (cmd.startsWith('echo-lines ')) {
      const text = cmd.slice('echo-lines '.length)
      const chunks = text.split('|')
      return this.makeOutput({
        stdout: JSON.stringify({ chunks, stderr: '', exitCode: 0 }),
        exitCode: 0,
      })
    }
    if (cmd === 'fail-stream') {
      return this.makeOutput({
        stdout: JSON.stringify({ chunks: ['partial-before-fail\n'], stderr: 'boom', exitCode: 1 }),
        exitCode: 0,
      })
    }
    if (cmd === 'no-output') {
      return this.makeOutput({
        stdout: JSON.stringify({ chunks: [], stderr: '', exitCode: 0 }),
        exitCode: 0,
      })
    }
    return this.makeOutput({
      stdout: JSON.stringify({ chunks: [], stderr: `unknown stream command: ${cmd}`, exitCode: 127 }),
      exitCode: 0,
    })
  }

  private handleEdit(stdin: string): SandboxExecOutput {
    let args: {
      path?: unknown
      oldString?: unknown
      newString?: unknown
      expectedOccurrences?: unknown
    }
    try {
      args = JSON.parse(stdin) as typeof args
    } catch {
      return this.makeOutput({ stdout: '', stderr: 'edit-bad-stdin', exitCode: 2 })
    }
    if (
      typeof args.path !== 'string' ||
      typeof args.oldString !== 'string' ||
      typeof args.newString !== 'string'
    ) {
      return this.makeOutput({ stdout: '', stderr: 'edit-missing-args', exitCode: 2 })
    }
    const expected =
      typeof args.expectedOccurrences === 'number' &&
      Number.isInteger(args.expectedOccurrences) &&
      args.expectedOccurrences > 0
        ? args.expectedOccurrences
        : 1
    const current = this.fs.get(args.path)
    if (current === undefined) {
      return this.makeOutput({
        stdout: '',
        stderr: `edit-no-such-file:${args.path}`,
        exitCode: 1,
      })
    }
    const occurrences = countOccurrences(current, args.oldString)
    if (occurrences !== expected) {
      return this.makeOutput({
        stdout: '',
        stderr: `edit-occurrence-mismatch:expected=${expected}:actual=${occurrences}`,
        exitCode: 1,
      })
    }
    const next = current.split(args.oldString).join(args.newString)
    this.fs.set(args.path, next)
    return this.makeOutput({
      stdout: JSON.stringify({
        occurrencesReplaced: occurrences,
        bytesWritten: Buffer.byteLength(next, 'utf8'),
      }),
      exitCode: 0,
    })
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

const countOccurrences = (haystack: string, needle: string): number => {
  if (needle === '') return 0
  let count = 0
  let idx = 0
  while (true) {
    const found = haystack.indexOf(needle, idx)
    if (found === -1) return count
    count++
    idx = found + needle.length
  }
}

const makeGlobMatcher = (pattern: string): ((path: string) => boolean) => {
  // Minimal glob -> regex translation sufficient for fake-sandbox tests:
  //   **  -> match any path including separators
  //   *   -> match any chars except '/'
  //   ?   -> match exactly one non-separator char
  let re = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*'
        i++
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else if (c !== undefined && /[.+^${}()|[\]\\]/.test(c)) {
      re += `\\${c}`
    } else {
      re += c
    }
  }
  const compiled = new RegExp(`^${re}$`)
  return (path) => compiled.test(path)
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
