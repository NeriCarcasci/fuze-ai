import { CircuitOpenError } from './errors.js'

export interface CircuitBreakerOptions {
  threshold?: number
  openMs?: number
  now?: () => number
}

type State = 'closed' | 'open' | 'half-open'

export class CircuitBreaker {
  readonly threshold: number
  readonly openMs: number
  private readonly now: () => number
  private state: State = 'closed'
  private failures = 0
  private openedAt = 0

  constructor(options: CircuitBreakerOptions = {}) {
    this.threshold = options.threshold ?? 3
    this.openMs = options.openMs ?? 30_000
    this.now = options.now ?? Date.now
  }

  get currentState(): State {
    if (this.state === 'open' && this.now() - this.openedAt >= this.openMs) {
      this.state = 'half-open'
    }
    return this.state
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const s = this.currentState
    if (s === 'open') {
      throw new CircuitOpenError('circuit breaker is open')
    }
    try {
      const result = await fn()
      this.recordSuccess()
      return result
    } catch (err) {
      this.recordFailure()
      throw err
    }
  }

  recordSuccess(): void {
    this.failures = 0
    this.state = 'closed'
  }

  recordFailure(): void {
    if (this.state === 'half-open') {
      this.trip()
      return
    }
    this.failures += 1
    if (this.failures >= this.threshold) {
      this.trip()
    }
  }

  private trip(): void {
    this.state = 'open'
    this.openedAt = this.now()
    this.failures = this.threshold
  }
}
