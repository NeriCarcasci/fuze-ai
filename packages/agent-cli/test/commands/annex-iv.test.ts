import { describe, expect, it } from 'vitest'
import { runAnnexIvCommand } from '../../src/commands/annex-iv.js'

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

const recordLine = JSON.stringify({
  sequence: 0,
  prevHash: '0'.repeat(64),
  hash: 'a'.repeat(64),
  payload: {
    span: 'agent.step',
    role: 'agent',
    runId: 'run-1',
    stepId: 'step-1',
    startedAt: '2026-01-01T00:00:00Z',
    endedAt: '2026-01-01T00:00:01Z',
    common: {
      'fuze.tenant.id': 'tenant-a',
      'fuze.principal.id': 'p',
      'fuze.lawful_basis': 'contract',
      'fuze.annex_iii_domain': 'none',
      'fuze.art22_decision': false,
      'fuze.retention.policy_id': 'r1',
    },
    attrs: { 'gen_ai.request.model': 'gpt' },
  },
})

describe('annex-iv command', () => {
  it('errors when records path is missing', async () => {
    const result = await runAnnexIvCommand({
      agentDefinitionPath: '/tmp/a.json',
      recordsPath: '',
      readFileImpl: async () => JSON.stringify(definition),
    })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('--records')
  })

  it('emits a report for valid inputs (commission default)', async () => {
    const reads: Record<string, string> = {
      '/a.json': JSON.stringify(definition),
      '/r.jsonl': recordLine,
    }
    const result = await runAnnexIvCommand({
      agentDefinitionPath: '/a.json',
      recordsPath: '/r.jsonl',
      readFileImpl: async (p) => reads[p] ?? '',
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('eu-ai-act-annex-iv')
    expect(result.stdout).toContain('§3(a) technical specifications')
  })

  it('uses iso-42001 mapping when requested', async () => {
    const reads: Record<string, string> = {
      '/a.json': JSON.stringify(definition),
      '/r.jsonl': recordLine,
    }
    const result = await runAnnexIvCommand({
      agentDefinitionPath: '/a.json',
      recordsPath: '/r.jsonl',
      mapping: 'iso-42001',
      readFileImpl: async (p) => reads[p] ?? '',
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('iso-42001')
  })
})
