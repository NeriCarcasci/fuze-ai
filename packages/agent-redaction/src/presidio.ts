import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Finding, PiiKind, RedactionEngine, RedactionResult } from './types.js'

export interface JsonRpcRequest {
  readonly jsonrpc: '2.0'
  readonly id: number
  readonly method: string
  readonly params: { readonly value: unknown }
}

export interface JsonRpcResponse {
  readonly jsonrpc: '2.0'
  readonly id: number
  readonly result?: {
    readonly value: unknown
    readonly findings: readonly { readonly kind: string; readonly count: number; readonly fields: readonly string[] }[]
    readonly confidence: number
  }
  readonly error?: { readonly code: number; readonly message: string }
}

export interface SidecarTransport {
  send(req: JsonRpcRequest, timeoutMs: number): Promise<JsonRpcResponse>
  close(): Promise<void>
}

const KNOWN_KINDS: ReadonlySet<string> = new Set<PiiKind>([
  'email',
  'phone',
  'phone-de',
  'phone-fr',
  'phone-it',
  'phone-es',
  'phone-uk',
  'iban',
  'ipv4',
  'ipv6',
  'mac',
  'creditCard',
  'jwt',
  'oauth-bearer',
  'de-steuer-id',
  'fr-insee',
  'it-codice-fiscale',
  'person',
  'location',
  'organization',
  'classifier-error',
])

const coerceKind = (raw: string): PiiKind => {
  if (KNOWN_KINDS.has(raw)) return raw as PiiKind
  return 'person'
}

const classifierError = (value: unknown, message: string): RedactionResult => ({
  value,
  findings: [{ kind: 'classifier-error', count: 1, fields: [message] }],
  confidence: 0,
})

export interface PresidioSidecarEngineOptions {
  readonly transport: SidecarTransport
  readonly name?: string
  readonly timeoutMs?: number
}

export class PresidioSidecarEngine implements RedactionEngine {
  readonly name: string
  readonly #transport: SidecarTransport
  readonly #timeoutMs: number
  #seq = 0

  constructor(opts: PresidioSidecarEngineOptions) {
    this.name = opts.name ?? 'fuze.redaction.presidio'
    this.#transport = opts.transport
    this.#timeoutMs = opts.timeoutMs ?? 5000
  }

  async redact(value: unknown): Promise<RedactionResult> {
    this.#seq += 1
    const req: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: this.#seq,
      method: 'analyze',
      params: { value },
    }
    let resp: JsonRpcResponse
    try {
      resp = await this.#transport.send(req, this.#timeoutMs)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'transport-failure'
      return classifierError(value, msg)
    }
    if (resp.error !== undefined) {
      return classifierError(value, resp.error.message)
    }
    const result = resp.result
    if (result === undefined) {
      return classifierError(value, 'missing-result')
    }
    const findings: Finding[] = result.findings.map((f) => ({
      kind: coerceKind(f.kind),
      count: f.count,
      fields: f.fields,
    }))
    return {
      value: result.value,
      findings,
      confidence: result.confidence,
    }
  }

  async close(): Promise<void> {
    await this.#transport.close()
  }
}

export type FakeHandler = (req: JsonRpcRequest) => Promise<JsonRpcResponse> | JsonRpcResponse

export class FakeSidecarTransport implements SidecarTransport {
  readonly #handler: FakeHandler

  constructor(handler: FakeHandler) {
    this.#handler = handler
  }

  async send(req: JsonRpcRequest, timeoutMs: number): Promise<JsonRpcResponse> {
    return await new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('sidecar-timeout')), timeoutMs)
      Promise.resolve(this.#handler(req))
        .then((r) => {
          clearTimeout(timer)
          resolve(r)
        })
        .catch((e: unknown) => {
          clearTimeout(timer)
          reject(e instanceof Error ? e : new Error(String(e)))
        })
    })
  }

  async close(): Promise<void> {
    return
  }
}

export interface ChildProcessSidecarTransportOptions {
  readonly command: string
  readonly args?: readonly string[]
}

interface PendingCall {
  readonly resolve: (resp: JsonRpcResponse) => void
  readonly reject: (err: Error) => void
  readonly timer: NodeJS.Timeout
}

export class ChildProcessSidecarTransport implements SidecarTransport {
  readonly #child: ChildProcessWithoutNullStreams
  readonly #pending = new Map<number, PendingCall>()
  #buffer = ''
  #closed = false

  constructor(opts: ChildProcessSidecarTransportOptions) {
    this.#child = spawn(opts.command, opts.args ?? [], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.#child.stdout.setEncoding('utf8')
    this.#child.stdout.on('data', (chunk: string) => this.#onData(chunk))
    this.#child.on('exit', () => this.#failAll(new Error('sidecar-exited')))
    this.#child.on('error', (err) => this.#failAll(err))
  }

  #onData(chunk: string): void {
    this.#buffer += chunk
    let idx = this.#buffer.indexOf('\n')
    while (idx !== -1) {
      const line = this.#buffer.slice(0, idx)
      this.#buffer = this.#buffer.slice(idx + 1)
      if (line.trim() !== '') this.#dispatch(line)
      idx = this.#buffer.indexOf('\n')
    }
  }

  #dispatch(line: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      return
    }
    if (typeof parsed !== 'object' || parsed === null) return
    const obj = parsed as { id?: unknown }
    if (typeof obj.id !== 'number') return
    const pending = this.#pending.get(obj.id)
    if (pending === undefined) return
    this.#pending.delete(obj.id)
    clearTimeout(pending.timer)
    pending.resolve(parsed as JsonRpcResponse)
  }

  #failAll(err: Error): void {
    this.#closed = true
    for (const [, p] of this.#pending) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.#pending.clear()
  }

  async send(req: JsonRpcRequest, timeoutMs: number): Promise<JsonRpcResponse> {
    if (this.#closed) throw new Error('sidecar-closed')
    return await new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(req.id)
        reject(new Error('sidecar-timeout'))
      }, timeoutMs)
      this.#pending.set(req.id, { resolve, reject, timer })
      this.#child.stdin.write(`${JSON.stringify(req)}\n`, (err) => {
        if (err !== undefined && err !== null) {
          this.#pending.delete(req.id)
          clearTimeout(timer)
          reject(err)
        }
      })
    })
  }

  async close(): Promise<void> {
    this.#closed = true
    this.#child.stdin.end()
    this.#child.kill()
  }
}
