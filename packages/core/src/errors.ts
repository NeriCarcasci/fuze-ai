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
 * Thrown when a step or run exceeds its budget ceiling.
 *
 * @example
 * "BudgetExceeded: step 'analyse' estimated $0.60 but step ceiling is $0.50 (run spent $0.42 of $1.00)"
 */
export class BudgetExceeded extends FuzeError {
  /** The estimated cost that triggered the error. */
  readonly estimatedCost: number
  /** The ceiling that was breached (step or run). */
  readonly ceiling: number
  /** Total cost spent so far in the run. */
  readonly spent: number
  /** Whether this was a step-level or run-level breach. */
  readonly level: 'step' | 'run'

  constructor(opts: {
    toolName: string
    estimatedCost: number
    ceiling: number
    spent: number
    level: 'step' | 'run'
  }) {
    const levelLabel = opts.level === 'step' ? 'step ceiling' : 'run ceiling'
    super(
      `BudgetExceeded: step '${opts.toolName}' estimated $${opts.estimatedCost.toFixed(4)} ` +
      `but ${levelLabel} is $${opts.ceiling.toFixed(4)} ` +
      `(run spent $${opts.spent.toFixed(4)} of $${opts.ceiling.toFixed(4)})`
    )
    this.name = 'BudgetExceeded'
    this.estimatedCost = opts.estimatedCost
    this.ceiling = opts.ceiling
    this.spent = opts.spent
    this.level = opts.level
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
      cost_velocity: `LoopDetected: ${prefix} spending $${signal.details['velocity'] ?? '?'}/min exceeds threshold`,
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
