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

interface RawResult {
  stdout: string
  stderr: string
  exitCode: number
}

const shQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

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

    let result: RawResult
    try {
      result = await this.runWithTimeout(
        bash,
        input,
        controller,
        () => timedOut,
        timeoutMs,
        { tenant: ctx.tenant, runId: ctx.runId },
      )
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

  private async runWithTimeout(
    bash: BashInstance,
    input: SandboxExecInput,
    controller: AbortController,
    isTimedOut: () => boolean,
    timeoutMs: number,
    key: InstanceKey,
  ): Promise<RawResult> {
    const execFn = (command: string, stdin?: string): Promise<RawResult> => {
      const opts: { stdin?: string; env?: Readonly<Record<string, string>>; signal: AbortSignal } = {
        signal: controller.signal,
      }
      if (stdin !== undefined) opts.stdin = stdin
      if (input.env !== undefined) opts.env = input.env
      return bash.exec(command, opts)
    }

    try {
      const work = this.dispatch(input, execFn, key)
      const timeoutPromise = new Promise<RawResult>((resolve) => {
        controller.signal.addEventListener('abort', () =>
          resolve({ stdout: '', stderr: `timeout after ${timeoutMs}ms`, exitCode: 124 }),
        )
      })
      const settled = await Promise.race([
        work.then((value) => ({ ok: true as const, value })),
        timeoutPromise.then((value) => ({ ok: true as const, value })),
      ])
      if (settled.ok) return settled.value
      throw new Error('unreachable')
    } catch (err) {
      if (isTimedOut()) {
        return { stdout: '', stderr: `timeout after ${timeoutMs}ms`, exitCode: 124 }
      }
      throw err
    }
  }

  private async dispatch(
    input: SandboxExecInput,
    exec: (cmd: string, stdin?: string) => Promise<RawResult>,
    key: InstanceKey,
  ): Promise<RawResult> {
    const cmd = input.command
    if (cmd.startsWith('read_file ')) {
      return exec(`cat -- ${shQuote(cmd.slice('read_file '.length))}`)
    }
    if (cmd.startsWith('write_file ')) {
      const path = cmd.slice('write_file '.length)
      const stdin = input.stdin ?? ''
      const r = await exec(`cat > ${shQuote(path)}`, stdin)
      if (r.exitCode !== 0) return r
      return { stdout: String(Buffer.byteLength(stdin, 'utf8')), stderr: '', exitCode: 0 }
    }
    if (cmd.startsWith('list_files ')) {
      const path = cmd.slice('list_files '.length)
      const r = await exec(`ls -1 -- ${shQuote(path)}`)
      if (r.exitCode !== 0) return r
      const entries = r.stdout.split('\n').filter((s) => s.length > 0).join('\n')
      return { stdout: entries, stderr: '', exitCode: 0 }
    }
    if (cmd === 'grep') return this.runGrep(input.stdin ?? '', exec)
    if (cmd === 'glob') return this.runGlob(input.stdin ?? '', exec)
    if (cmd === 'edit') return this.runEdit(input.stdin ?? '', exec)
    if (cmd === 'bash_stream') return this.runBashStream(input.stdin ?? '', exec)
    if (cmd.startsWith('fetch ')) {
      return this.runFetch(
        { url: cmd.slice('fetch '.length), method: 'GET' },
        key,
      )
    }
    if (cmd === 'fetch') return this.runFetchFromStdin(input.stdin ?? '', key)
    return exec(cmd, input.stdin)
  }

  private async listFilesRecursive(
    path: string,
    exec: (cmd: string, stdin?: string) => Promise<RawResult>,
  ): Promise<{ ok: true; paths: string[] } | { ok: false; result: RawResult }> {
    const r = await exec(`find ${shQuote(path)} -type f`)
    if (r.exitCode !== 0) return { ok: false, result: r }
    const paths = r.stdout.split('\n').map((s) => s.trim()).filter((s) => s.length > 0)
    return { ok: true, paths }
  }

  private async runGrep(
    stdin: string,
    exec: (cmd: string, stdin?: string) => Promise<RawResult>,
  ): Promise<RawResult> {
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
      return { stdout: '', stderr: 'grep-bad-stdin', exitCode: 2 }
    }
    if (typeof args.pattern !== 'string' || typeof args.path !== 'string') {
      return { stdout: '', stderr: 'grep-missing-args', exitCode: 2 }
    }
    let regex: RegExp
    try {
      regex = new RegExp(args.pattern, args.caseInsensitive === true ? 'i' : undefined)
    } catch (err) {
      return {
        stdout: '',
        stderr: `grep-invalid-pattern:${(err as Error).message}`,
        exitCode: 2,
      }
    }
    const max =
      typeof args.maxMatches === 'number' && Number.isInteger(args.maxMatches) && args.maxMatches > 0
        ? args.maxMatches
        : 1000
    const globMatcher = typeof args.glob === 'string' ? makeGlobMatcher(args.glob) : null
    const enumerated = await this.listFilesRecursive(args.path, exec)
    if (!enumerated.ok) {
      return {
        stdout: JSON.stringify({ matches: [], truncated: false }),
        stderr: '',
        exitCode: 0,
      }
    }
    const matches: Array<{ path: string; line: number; text: string }> = []
    let truncated = false
    for (const path of enumerated.paths) {
      if (globMatcher && !globMatcher(path)) continue
      const cat = await exec(`cat -- ${shQuote(path)}`)
      if (cat.exitCode !== 0) continue
      const lines = cat.stdout.split('\n')
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
    return { stdout: JSON.stringify({ matches, truncated }), stderr: '', exitCode: 0 }
  }

  private async runGlob(
    stdin: string,
    exec: (cmd: string, stdin?: string) => Promise<RawResult>,
  ): Promise<RawResult> {
    let args: { pattern?: unknown; path?: unknown; maxResults?: unknown }
    try {
      args = JSON.parse(stdin) as typeof args
    } catch {
      return { stdout: '', stderr: 'glob-bad-stdin', exitCode: 2 }
    }
    if (typeof args.pattern !== 'string') {
      return { stdout: '', stderr: 'glob-missing-args', exitCode: 2 }
    }
    const max =
      typeof args.maxResults === 'number' && Number.isInteger(args.maxResults) && args.maxResults > 0
        ? args.maxResults
        : 10_000
    const root = typeof args.path === 'string' && args.path.length > 0 ? args.path : '/'
    const rootPrefix = root === '' ? '' : root.endsWith('/') ? root : `${root}/`
    const matcher = makeGlobMatcher(args.pattern)
    const enumerated = await this.listFilesRecursive(root, exec)
    if (!enumerated.ok) {
      return { stdout: JSON.stringify({ paths: [], truncated: false }), stderr: '', exitCode: 0 }
    }
    const paths: string[] = []
    let truncated = false
    for (const path of enumerated.paths) {
      const rel = rootPrefix === '' ? path : path.startsWith(rootPrefix) ? path.slice(rootPrefix.length) : path
      if (matcher(rel)) {
        if (paths.length >= max) {
          truncated = true
          break
        }
        paths.push(path)
      }
    }
    return { stdout: JSON.stringify({ paths, truncated }), stderr: '', exitCode: 0 }
  }

  private async runEdit(
    stdin: string,
    exec: (cmd: string, stdin?: string) => Promise<RawResult>,
  ): Promise<RawResult> {
    let args: {
      path?: unknown
      oldString?: unknown
      newString?: unknown
      expectedOccurrences?: unknown
    }
    try {
      args = JSON.parse(stdin) as typeof args
    } catch {
      return { stdout: '', stderr: 'edit-bad-stdin', exitCode: 2 }
    }
    if (
      typeof args.path !== 'string' ||
      typeof args.oldString !== 'string' ||
      typeof args.newString !== 'string'
    ) {
      return { stdout: '', stderr: 'edit-missing-args', exitCode: 2 }
    }
    const expected =
      typeof args.expectedOccurrences === 'number' &&
      Number.isInteger(args.expectedOccurrences) &&
      args.expectedOccurrences > 0
        ? args.expectedOccurrences
        : 1
    const cat = await exec(`cat -- ${shQuote(args.path)}`)
    if (cat.exitCode !== 0) {
      return { stdout: '', stderr: `edit-no-such-file:${args.path}`, exitCode: 1 }
    }
    const current = cat.stdout
    const occurrences = countOccurrences(current, args.oldString)
    if (occurrences !== expected) {
      return {
        stdout: '',
        stderr: `edit-occurrence-mismatch:expected=${expected}:actual=${occurrences}`,
        exitCode: 1,
      }
    }
    const next = current.split(args.oldString).join(args.newString)
    const write = await exec(`cat > ${shQuote(args.path)}`, next)
    if (write.exitCode !== 0) return write
    return {
      stdout: JSON.stringify({
        occurrencesReplaced: occurrences,
        bytesWritten: Buffer.byteLength(next, 'utf8'),
      }),
      stderr: '',
      exitCode: 0,
    }
  }

  private async runBashStream(
    stdin: string,
    exec: (cmd: string, stdin?: string) => Promise<RawResult>,
  ): Promise<RawResult> {
    let args: { command?: unknown; stdin?: unknown }
    try {
      args = JSON.parse(stdin) as typeof args
    } catch {
      return { stdout: '', stderr: 'bash_stream-bad-stdin', exitCode: 2 }
    }
    if (typeof args.command !== 'string') {
      return { stdout: '', stderr: 'bash_stream-missing-command', exitCode: 2 }
    }
    const innerStdin = typeof args.stdin === 'string' ? args.stdin : undefined
    const r = await exec(args.command, innerStdin)
    const chunks = r.stdout.length === 0 ? [] : r.stdout.split(/(?<=\n)/).filter((s) => s.length > 0)
    return {
      stdout: JSON.stringify({ chunks, stderr: r.stderr, exitCode: r.exitCode }),
      stderr: '',
      exitCode: 0,
    }
  }

  private async runFetchFromStdin(
    stdin: string,
    key: InstanceKey,
  ): Promise<RawResult> {
    let args: {
      url?: unknown
      method?: unknown
      headers?: unknown
      body?: unknown
    }
    try {
      args = JSON.parse(stdin) as typeof args
    } catch {
      return { stdout: '', stderr: 'fetch-bad-stdin', exitCode: 2 }
    }
    if (typeof args.url !== 'string') {
      return { stdout: '', stderr: 'fetch-missing-url', exitCode: 2 }
    }
    const method =
      typeof args.method === 'string' && args.method.length > 0 ? args.method : 'GET'
    const headers: Record<string, string> = {}
    if (args.headers && typeof args.headers === 'object') {
      for (const [k, v] of Object.entries(args.headers as Record<string, unknown>)) {
        if (typeof v === 'string') headers[k] = v
      }
    }
    const req: { url: string; method: string; headers: Record<string, string>; body?: string } = {
      url: args.url,
      method,
      headers,
    }
    if (typeof args.body === 'string') req.body = args.body
    return this.runFetch(req, key)
  }

  private async runFetch(
    req: {
      url: string
      method: string
      headers?: Record<string, string>
      body?: string
    },
    key: InstanceKey,
  ): Promise<RawResult> {
    if (this.onFetch) {
      this.onFetch({
        url: req.url,
        method: req.method,
        tenant: key.tenant,
        runId: key.runId,
      })
    }
    if (
      this.allowedFetchPrefixes.length > 0 &&
      !this.allowedFetchPrefixes.some((p) => req.url.startsWith(p))
    ) {
      return { stdout: '', stderr: `fetch denied: ${req.url}`, exitCode: 1 }
    }
    try {
      const init: RequestInit = { method: req.method }
      if (req.headers) init.headers = req.headers
      if (req.body !== undefined) init.body = req.body
      const resp = await fetch(req.url, init)
      const respBody = await resp.text()
      const respHeaders: Record<string, string> = {}
      resp.headers.forEach((v, k) => {
        respHeaders[k] = v
      })
      return {
        stdout: JSON.stringify({ status: resp.status, body: respBody, headers: respHeaders }),
        stderr: '',
        exitCode: 0,
      }
    } catch (err) {
      return { stdout: '', stderr: `fetch-failed:${(err as Error).message}`, exitCode: 1 }
    }
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
