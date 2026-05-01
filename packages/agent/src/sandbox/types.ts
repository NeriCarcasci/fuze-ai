import type { Ctx } from '../types/ctx.js'
import type { ThreatBoundary } from '../types/compliance.js'

export type SandboxTier = 'in-process' | 'vm-managed' | 'vm-self-hosted'

export interface SandboxExecInput {
  readonly command: string
  readonly stdin?: string
  readonly env?: Readonly<Record<string, string>>
  readonly timeoutMs?: number
}

export interface SandboxExecOutput {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
  readonly durationMs: number
  readonly tier: SandboxTier
  readonly truncated: boolean
}

export interface FuzeSandbox {
  readonly tier: SandboxTier
  readonly threatBoundary: ThreatBoundary
  exec(input: SandboxExecInput, ctx: Ctx<unknown>): Promise<SandboxExecOutput>
  dispose?(): Promise<void>
}

export class SandboxRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SandboxRefusedError'
  }
}
