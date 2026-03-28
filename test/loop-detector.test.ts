import { describe, it, expect } from 'vitest'
import { LoopDetector } from '../src/loop-detector.js'

describe('LoopDetector', () => {
  describe('Layer 1: iteration cap', () => {
    it('returns max_iterations signal after exceeding cap', () => {
      const detector = new LoopDetector({
        maxIterations: 3,
        windowSize: 5,
        repeatThreshold: 3,
        maxFlatSteps: 4,
        costVelocityWindow: 60,
        costVelocityThreshold: 1.0,
      })

      expect(detector.onStep()).toBeNull() // 1
      expect(detector.onStep()).toBeNull() // 2
      expect(detector.onStep()).toBeNull() // 3

      const signal = detector.onStep() // 4 > max of 3
      expect(signal).not.toBeNull()
      expect(signal!.type).toBe('max_iterations')
      expect(signal!.details['count']).toBe(4)
    })
  })

  describe('Layer 2: repeated tool call detection', () => {
    it('returns repeated_tool signal after consecutive identical calls', () => {
      const detector = new LoopDetector({
        maxIterations: 100,
        windowSize: 5,
        repeatThreshold: 3,
        maxFlatSteps: 10,
        costVelocityWindow: 60,
        costVelocityThreshold: 1.0,
      })

      expect(detector.onToolCall('search:abc123')).toBeNull()
      expect(detector.onToolCall('search:abc123')).toBeNull()

      const signal = detector.onToolCall('search:abc123')
      expect(signal).not.toBeNull()
      expect(signal!.type).toBe('repeated_tool')
      expect(signal!.details['count']).toBe(3)
    })

    it('does not trigger for non-consecutive repeated calls (ABAB pattern)', () => {
      const detector = new LoopDetector({
        maxIterations: 100,
        windowSize: 5,
        repeatThreshold: 3,
        maxFlatSteps: 10,
        costVelocityWindow: 60,
        costVelocityThreshold: 1.0,
      })

      // ABAB pattern: never 3 consecutive identical
      expect(detector.onToolCall('search:abc')).toBeNull()
      expect(detector.onToolCall('search:def')).toBeNull()
      expect(detector.onToolCall('search:abc')).toBeNull()
      expect(detector.onToolCall('search:def')).toBeNull()
      expect(detector.onToolCall('search:abc')).toBeNull()

      // None of these should trigger since consecutive count never reaches 3
    })

    it('does not trigger when different signatures are within window', () => {
      const detector = new LoopDetector({
        maxIterations: 100,
        windowSize: 5,
        repeatThreshold: 3,
        maxFlatSteps: 10,
        costVelocityWindow: 60,
        costVelocityThreshold: 1.0,
      })

      expect(detector.onToolCall('search:abc')).toBeNull()
      expect(detector.onToolCall('search:def')).toBeNull()
      expect(detector.onToolCall('search:ghi')).toBeNull()
      expect(detector.onToolCall('search:jkl')).toBeNull()
      expect(detector.onToolCall('search:mno')).toBeNull()
      // All different, no trigger
    })

    it('triggers when consecutive count hits threshold within window', () => {
      const detector = new LoopDetector({
        maxIterations: 100,
        windowSize: 3,
        repeatThreshold: 3,
        maxFlatSteps: 10,
        costVelocityWindow: 60,
        costVelocityThreshold: 1.0,
      })

      expect(detector.onToolCall('other:xyz')).toBeNull()
      expect(detector.onToolCall('search:abc')).toBeNull()
      expect(detector.onToolCall('search:abc')).toBeNull()

      // Window is now [search:abc, search:abc, search:abc]... wait,
      // window is size 3, the "other:xyz" was pushed out.
      // Actually: [other:xyz, search:abc, search:abc] — only 2 consecutive
      // Need one more:
      const signal = detector.onToolCall('search:abc')
      expect(signal).not.toBeNull()
      expect(signal!.type).toBe('repeated_tool')
    })
  })

  describe('Layer 3: no-progress detection', () => {
    it('returns no_progress signal after consecutive steps without novel output', () => {
      const detector = new LoopDetector({
        maxIterations: 100,
        windowSize: 5,
        repeatThreshold: 3,
        maxFlatSteps: 4,
        costVelocityWindow: 60,
        costVelocityThreshold: 1.0,
      })

      expect(detector.onProgress(false)).toBeNull() // flat 1
      expect(detector.onProgress(false)).toBeNull() // flat 2
      expect(detector.onProgress(false)).toBeNull() // flat 3

      const signal = detector.onProgress(false) // flat 4 = maxFlatSteps
      expect(signal).not.toBeNull()
      expect(signal!.type).toBe('no_progress')
      expect(signal!.details['flatSteps']).toBe(4)
    })

    it('resets flat step count when new signal appears', () => {
      const detector = new LoopDetector({
        maxIterations: 100,
        windowSize: 5,
        repeatThreshold: 3,
        maxFlatSteps: 4,
        costVelocityWindow: 60,
        costVelocityThreshold: 1.0,
      })

      expect(detector.onProgress(false)).toBeNull() // flat 1
      expect(detector.onProgress(false)).toBeNull() // flat 2
      expect(detector.onProgress(true)).toBeNull()  // reset!
      expect(detector.onProgress(false)).toBeNull() // flat 1
      expect(detector.onProgress(false)).toBeNull() // flat 2
      expect(detector.onProgress(false)).toBeNull() // flat 3

      // Still not at 4, so no trigger
      const signal = detector.onProgress(false) // flat 4
      expect(signal).not.toBeNull()
      expect(signal!.type).toBe('no_progress')
    })
  })

  describe('reset', () => {
    it('clears all internal state', () => {
      const detector = new LoopDetector({
        maxIterations: 2,
        windowSize: 5,
        repeatThreshold: 3,
        maxFlatSteps: 4,
        costVelocityWindow: 60,
        costVelocityThreshold: 1.0,
      })

      detector.onStep() // 1
      detector.onStep() // 2
      // Next would trigger, but let's reset
      detector.reset()

      expect(detector.onStep()).toBeNull() // 1 again after reset
      expect(detector.onStep()).toBeNull() // 2 again after reset
    })
  })
})
