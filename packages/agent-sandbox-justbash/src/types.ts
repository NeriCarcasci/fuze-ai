export interface BashLogEntry {
  readonly command: string
  readonly exitCode: number
  readonly durationMs: number
  readonly tenant: string
  readonly runId: string
}

export interface BashFetchEntry {
  readonly url: string
  readonly method: string
  readonly tenant: string
  readonly runId: string
}

export interface BashExecOptions {
  readonly stdin?: string
  readonly env?: Readonly<Record<string, string>>
  readonly cwd?: string
  readonly signal?: AbortSignal
}

export interface BashExecResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

export interface BashLoggerEvent {
  readonly command: string
  readonly exitCode: number
  readonly durationMs: number
}

export interface BashInstance {
  exec(command: string, opts?: BashExecOptions): Promise<BashExecResult>
}

export interface BashCreateOptions {
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string>>
  readonly files?: Readonly<Record<string, string>>
  readonly logger?: (event: BashLoggerEvent) => void
  readonly fetch?: (url: string, init?: { method?: string }) => Promise<Response>
}

export interface BashFactory {
  create(opts: BashCreateOptions): BashInstance
}
