import type { LoopSignal } from './types.js'

/**
 * Base error class for all Fuze errors.
 */
export class FuzeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FuzeError'
  }
}

/**
 * Thrown when the loop detector identifies a loop condition.
 */
export class LoopDetected extends FuzeError {
  /** The loop signal that triggered this error. */
  readonly signal: LoopSignal

  constructor(signal: LoopSignal, toolName?: string) {
    const prefix = toolName ? `step '${toolName}'` : 'run'
    const messages: Record<LoopSignal['type'], string> = {
      max_iterations: `LoopDetected: ${prefix} hit iteration cap (${signal.details['count'] ?? 'unknown'} iterations)`,
      repeated_tool: `LoopDetected: ${prefix} repeated identical call ${signal.details['count'] ?? 'unknown'} times in window of ${signal.details['windowSize'] ?? 'unknown'}`,
      no_progress: `LoopDetected: ${prefix} made ${signal.details['flatSteps'] ?? 'unknown'} consecutive steps with no new output`,
    }
    super(messages[signal.type])
    this.name = 'LoopDetected'
    this.signal = signal
  }
}

/**
 * Thrown when a guarded function exceeds its timeout.
 */
export class GuardTimeout extends FuzeError {
  /** The timeout duration in milliseconds. */
  readonly timeoutMs: number

  constructor(toolName: string, timeoutMs: number) {
    super(
      `GuardTimeout: step '${toolName}' exceeded timeout of ${timeoutMs}ms`
    )
    this.name = 'GuardTimeout'
    this.timeoutMs = timeoutMs
  }
}

export type ResourceLimitKind = 'maxSteps' | 'maxTokensPerRun' | 'maxWallClockMs'

export interface ResourceLimitExceededDetails {
  toolName: string
  limit: ResourceLimitKind
  ceiling: number
  observed: number
}

export class ResourceLimitExceeded extends FuzeError {
  readonly details: ResourceLimitExceededDetails

  constructor(details: ResourceLimitExceededDetails) {
    super(
      `ResourceLimitExceeded: step '${details.toolName}' exceeded ${details.limit} (observed ${details.observed}, ceiling ${details.ceiling})`,
    )
    this.name = 'ResourceLimitExceeded'
    this.details = details
  }
}
