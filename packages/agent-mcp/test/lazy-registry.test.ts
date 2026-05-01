import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { DEFAULT_RETENTION, Ok, type AnyFuzeTool, type ThreatBoundary } from '@fuze-ai/agent'
import { LazyToolRegistry, type BudgetExceededInfo } from '../src/lazy-registry.js'
import { unverifiedTool } from '../src/unverified.js'

const tb: ThreatBoundary = {
  trustedCallers: ['mcp-host'],
  observesSecrets: false,
  egressDomains: 'none',
  readsFilesystem: false,
  writesFilesystem: false,
}

const tool = (name: string, description: string): AnyFuzeTool =>
  unverifiedTool({
    name,
    description,
    inputSchema: z.unknown(),
    metadata: {
      dataClassification: 'public',
      retention: DEFAULT_RETENTION,
      threatBoundary: tb,
    },
    invoke: async () => Ok(null),
  })

describe('LazyToolRegistry', () => {
  it('returns all tools when under budget', () => {
    const reg = new LazyToolRegistry({ budgetTokens: 1000 })
    reg.addTools('s1', [tool('a', 'short'), tool('b', 'short too')])
    const out = reg.listForTask()
    expect(out.map((t) => t.name).sort()).toEqual(['a', 'b'])
  })

  it('fires onSoftWarn at >= 80% of budget', () => {
    const onSoftWarn = vi.fn()
    const reg = new LazyToolRegistry({ budgetTokens: 100, onSoftWarn })
    // 85 chars description -> ceil(86/4) = 22 tokens per tool; 4 tools = 88 tokens (>=80, <=100)
    const desc = 'x'.repeat(85)
    reg.addTools('s1', [tool('a', desc), tool('b', desc), tool('c', desc), tool('d', desc)])
    reg.listForTask()
    expect(onSoftWarn).toHaveBeenCalledTimes(1)
    const arg = onSoftWarn.mock.calls[0]?.[0] as { usedTokens: number; budgetTokens: number }
    expect(arg.budgetTokens).toBe(100)
    expect(arg.usedTokens).toBeGreaterThanOrEqual(80)
  })

  it('drops the longest-described tools first when over budget', () => {
    const reg = new LazyToolRegistry({ budgetTokens: 30 })
    reg.addTools('s1', [
      tool('small', 'aa'),
      tool('huge', 'x'.repeat(400)),
      tool('medium', 'x'.repeat(40)),
    ])
    const out = reg.listForTask().map((t) => t.name)
    expect(out).toContain('small')
    expect(out).not.toContain('huge')
  })

  it('calls onBudgetExceeded with droppedToolNames', () => {
    const seen: BudgetExceededInfo[] = []
    const reg = new LazyToolRegistry({
      budgetTokens: 20,
      onBudgetExceeded: (info) => seen.push(info),
    })
    reg.addTools('s1', [tool('keep', 'k'), tool('drop', 'x'.repeat(500))])
    reg.listForTask()
    expect(seen).toHaveLength(1)
    expect(seen[0]?.droppedToolNames).toContain('drop')
    expect(seen[0]?.budgetTokens).toBe(20)
    expect(seen[0]?.usedTokens).toBeGreaterThan(20)
  })

  it('returns an empty list for an empty registry', () => {
    const reg = new LazyToolRegistry()
    expect(reg.listForTask()).toEqual([])
  })

  it('default budget is 8000 tokens', () => {
    const reg = new LazyToolRegistry()
    reg.addTools('s1', [tool('a', 'x')])
    expect(reg.totalTokens()).toBeLessThan(8000)
    expect(reg.listForTask().map((t) => t.name)).toEqual(['a'])
  })
})
