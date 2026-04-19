import { describe, it, expect } from 'vitest'
import { ToolConfig } from '../../src/proxy/tool-config.js'

describe('ToolConfig', () => {
  it('returns built-in defaults when no config is provided', () => {
    const tc = new ToolConfig({})
    const cfg = tc.getToolConfig('any_tool')
    expect(cfg.estimatedTokens).toBe(0)
    expect(cfg.sideEffect).toBe(false)
    expect(cfg.maxCallsPerRun).toBe(Infinity)
    expect(cfg.timeout).toBe(30_000)
  })

  it('returns tool-specific config when defined', () => {
    const tc = new ToolConfig({
      execute: { estimated_tokens: 50, side_effect: true, max_calls_per_run: 10, timeout: 5000 },
    })
    const cfg = tc.getToolConfig('execute')
    expect(cfg.estimatedTokens).toBe(50)
    expect(cfg.sideEffect).toBe(true)
    expect(cfg.maxCallsPerRun).toBe(10)
    expect(cfg.timeout).toBe(5000)
  })

  it('falls back to [proxy.tools.default] for missing tool', () => {
    const tc = new ToolConfig({
      default: { estimated_tokens: 20, side_effect: false, timeout: 15_000 },
    })
    const cfg = tc.getToolConfig('unknown_tool')
    expect(cfg.estimatedTokens).toBe(20)
    expect(cfg.timeout).toBe(15_000)
  })

  it('tool-specific config overrides default', () => {
    const tc = new ToolConfig({
      default: { estimated_tokens: 20, side_effect: false },
      query: { estimated_tokens: 50 },
    })
    const cfg = tc.getToolConfig('query')
    expect(cfg.estimatedTokens).toBe(50)
    expect(cfg.sideEffect).toBe(false) // falls back to default
  })

  it('isSideEffect returns true for side-effect tools', () => {
    const tc = new ToolConfig({
      send_email: { side_effect: true },
    })
    expect(tc.isSideEffect('send_email')).toBe(true)
  })

  it('isSideEffect returns false for non-side-effect tools', () => {
    const tc = new ToolConfig({
      query: { side_effect: false },
    })
    expect(tc.isSideEffect('query')).toBe(false)
  })

  it('isSideEffect defaults to false when not configured', () => {
    const tc = new ToolConfig({})
    expect(tc.isSideEffect('any_tool')).toBe(false)
  })

  it('max_calls_per_run defaults to Infinity when not set', () => {
    const tc = new ToolConfig({ my_tool: { estimated_tokens: 10 } })
    expect(tc.getToolConfig('my_tool').maxCallsPerRun).toBe(Infinity)
  })
})
