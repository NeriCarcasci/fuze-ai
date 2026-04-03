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
      })

      expect(detector.onStep()).toBeNull()
      expect(detector.onStep()).toBeNull()
      expect(detector.onStep()).toBeNull()

      const signal = detector.onStep()
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
      })

      expect(detector.onToolCall('search:abc')).toBeNull()
      expect(detector.onToolCall('search:def')).toBeNull()
      expect(detector.onToolCall('search:abc')).toBeNull()
      expect(detector.onToolCall('search:def')).toBeNull()
      expect(detector.onToolCall('search:abc')).toBeNull()
    })

    it('does not trigger when different signatures are within window', () => {
      const detector = new LoopDetector({
        maxIterations: 100,
        windowSize: 5,
        repeatThreshold: 3,
        maxFlatSteps: 10,
      })

      expect(detector.onToolCall('search:abc')).toBeNull()
      expect(detector.onToolCall('search:def')).toBeNull()
      expect(detector.onToolCall('search:ghi')).toBeNull()
      expect(detector.onToolCall('search:jkl')).toBeNull()
      expect(detector.onToolCall('search:mno')).toBeNull()
    })

    it('triggers when consecutive count hits threshold within window', () => {
      const detector = new LoopDetector({
        maxIterations: 100,
        windowSize: 3,
        repeatThreshold: 3,
        maxFlatSteps: 10,
      })

      expect(detector.onToolCall('other:xyz')).toBeNull()
      expect(detector.onToolCall('search:abc')).toBeNull()
      expect(detector.onToolCall('search:abc')).toBeNull()

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
      })

      expect(detector.onProgress(false)).toBeNull()
      expect(detector.onProgress(false)).toBeNull()
      expect(detector.onProgress(false)).toBeNull()

      const signal = detector.onProgress(false)
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
      })

      expect(detector.onProgress(false)).toBeNull()
      expect(detector.onProgress(false)).toBeNull()
      expect(detector.onProgress(true)).toBeNull()
      expect(detector.onProgress(false)).toBeNull()
      expect(detector.onProgress(false)).toBeNull()
      expect(detector.onProgress(false)).toBeNull()

      const signal = detector.onProgress(false)
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
      })

      detector.onStep()
      detector.onStep()
      detector.reset()

      expect(detector.onStep()).toBeNull()
      expect(detector.onStep()).toBeNull()
    })
  })
})