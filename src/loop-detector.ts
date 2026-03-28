import type { LoopDetectorConfig, LoopSignal } from './types.js'

/**
 * Detects agent loops using three layers:
 * - Layer 1: Hard iteration cap
 * - Layer 2: Sliding window hash dedup for repeated tool calls
 * - Layer 3: No-progress detection (consecutive steps with no novel output)
 */
export class LoopDetector {
  private iterationCount = 0
  private readonly toolCallWindow: string[] = []
  private flatStepCount = 0

  constructor(private readonly config: LoopDetectorConfig) {}

  /**
   * Called every step. Checks Layer 1 (iteration cap).
   * @returns A LoopSignal if the iteration cap is reached, or null.
   */
  onStep(): LoopSignal | null {
    this.iterationCount++

    if (this.iterationCount > this.config.maxIterations) {
      return {
        type: 'max_iterations',
        details: {
          count: this.iterationCount,
          max: this.config.maxIterations,
        },
      }
    }

    return null
  }

  /**
   * Called every tool call with a signature hash of tool name + args.
   * Checks Layer 2 (sliding window dedup).
   * @param signature - Hash string identifying the tool call (e.g., "funcName:argsHash").
   * @returns A LoopSignal if repeated calls are detected, or null.
   */
  onToolCall(signature: string): LoopSignal | null {
    this.toolCallWindow.push(signature)

    // Trim window to configured size
    if (this.toolCallWindow.length > this.config.windowSize) {
      this.toolCallWindow.shift()
    }

    // Count consecutive identical signatures at the tail of the window
    let consecutiveCount = 0
    for (let i = this.toolCallWindow.length - 1; i >= 0; i--) {
      if (this.toolCallWindow[i] === signature) {
        consecutiveCount++
      } else {
        break
      }
    }

    if (consecutiveCount >= this.config.repeatThreshold) {
      return {
        type: 'repeated_tool',
        details: {
          signature,
          count: consecutiveCount,
          windowSize: this.config.windowSize,
        },
      }
    }

    return null
  }

  /**
   * Called after result analysis. Checks Layer 3 (no-progress detection).
   * @param hasNewSignal - Whether the step produced novel output.
   * @returns A LoopSignal if too many steps without progress, or null.
   */
  onProgress(hasNewSignal: boolean): LoopSignal | null {
    if (hasNewSignal) {
      this.flatStepCount = 0
      return null
    }

    this.flatStepCount++

    if (this.flatStepCount >= this.config.maxFlatSteps) {
      return {
        type: 'no_progress',
        details: {
          flatSteps: this.flatStepCount,
          maxFlatSteps: this.config.maxFlatSteps,
        },
      }
    }

    return null
  }

  /**
   * Resets the detector state. Useful when starting a new run.
   */
  reset(): void {
    this.iterationCount = 0
    this.toolCallWindow.length = 0
    this.flatStepCount = 0
  }
}
