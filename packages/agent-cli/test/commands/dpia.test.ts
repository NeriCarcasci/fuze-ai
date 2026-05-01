import { describe, expect, it } from 'vitest'
import { runDpiaCommand } from '../../src/commands/dpia.js'

const definition = {
  purpose: 'demo',
  lawfulBasis: 'contract',
  annexIIIDomain: 'none',
  producesArt22Decision: false,
  model: { provider: 'stub', model: 'm' },
  tools: [],
  guardrails: { input: [], toolResult: [], output: [] },
  output: {},
  maxSteps: 1,
  retryBudget: 0,
  retention: { id: 'r1', hashTtlDays: 30, fullContentTtlDays: 7, decisionTtlDays: 90 },
  deps: {},
}

describe('dpia command', () => {
  it('errors when path is missing', async () => {
    const result = await runDpiaCommand({ agentDefinitionPath: '' })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('agent-definition.json')
  })

  it('errors when JSON is invalid', async () => {
    const result = await runDpiaCommand({
      agentDefinitionPath: '/tmp/x.json',
      readFileImpl: async () => '{not json',
    })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('invalid JSON')
  })

  it('emits DPIA document for a valid definition', async () => {
    const result = await runDpiaCommand({
      agentDefinitionPath: '/tmp/x.json',
      readFileImpl: async () => JSON.stringify(definition),
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('"version"')
    expect(result.stdout).toContain('"purpose": "demo"')
  })
})
