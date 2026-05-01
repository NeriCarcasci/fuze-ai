export interface E2BCommandResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

export interface E2BRunOptions {
  readonly stdin?: string
  readonly timeoutMs?: number
  readonly env?: Readonly<Record<string, string>>
  readonly onStdout?: (chunk: string) => void
  readonly onStderr?: (chunk: string) => void
}

export interface E2BClient {
  run(command: string, opts?: E2BRunOptions): Promise<E2BCommandResult>
  pause(): Promise<string>
  kill(): Promise<void>
}

export interface E2BClientFactoryInput {
  readonly tenant: string
  readonly runId: string
  readonly domain?: string
  readonly timeoutMs?: number
  readonly resumeId?: string
}

export interface E2BClientFactory {
  create(input: E2BClientFactoryInput): Promise<E2BClient>
  resume?(id: string, input: E2BClientFactoryInput): Promise<E2BClient>
}
