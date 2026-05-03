import { describe, expect, it } from 'vitest'
import { HashChain, type ChainedRecord, type EvidenceSpan } from '@fuze-ai/agent'
import { synthesize } from '../src/index.js'

const toolSpan = (runId: string, tool: string, index: number, outcome: 'value' | 'error', latencyMs: number): EvidenceSpan => {
  const start = new Date(Date.UTC(2026, 3, 1, 10, 0, index, 0))
  const end = new Date(start.getTime() + latencyMs)
  return {
    span: 'tool.execute',
    role: 'tool',
    runId,
    stepId: `${runId}-${tool}-${index}`,
    startedAt: start.toISOString(),
    endedAt: end.toISOString(),
    common: {
      'fuze.tenant.id': 'tenant-1',
      'fuze.principal.id': 'principal-1',
      'fuze.annex_iii_domain': 'none',
      'fuze.art22_decision': false,
      'fuze.retention.policy_id': 'retention.v1',
    },
    attrs: {
      'gen_ai.tool.name': tool,
      'fuze.tool.outcome': outcome,
      'gen_ai.usage.input_tokens': 1,
      'gen_ai.usage.output_tokens': 1,
    },
  }
}

const modelSpan = (runId: string, tokens: number): EvidenceSpan => ({
  span: 'model.generate',
  role: 'model',
  runId,
  stepId: `${runId}-model`,
  startedAt: '2026-04-01T10:00:00.000Z',
  endedAt: '2026-04-01T10:00:00.100Z',
  common: {
    'fuze.tenant.id': 'tenant-1',
    'fuze.principal.id': 'principal-1',
    'fuze.annex_iii_domain': 'none',
    'fuze.art22_decision': false,
    'fuze.retention.policy_id': 'retention.v1',
  },
  attrs: {
    'gen_ai.usage.input_tokens': tokens,
    'gen_ai.usage.output_tokens': tokens,
  },
})

const fingerprintSpan = (runId: string, fingerprint: string): EvidenceSpan => ({
  span: 'agent.invoke',
  role: 'agent',
  runId,
  stepId: `${runId}-agent`,
  startedAt: '2026-04-01T09:59:59.000Z',
  endedAt: '2026-04-01T10:00:00.000Z',
  common: {
    'fuze.tenant.id': 'tenant-1',
    'fuze.principal.id': 'principal-1',
    'fuze.annex_iii_domain': 'none',
    'fuze.art22_decision': false,
    'fuze.retention.policy_id': 'retention.v1',
  },
  attrs: { 'fuze.agent.definition_fingerprint': fingerprint },
})

const run = (
  id: string,
  tools: readonly string[],
  opts: { readonly tokens?: number; readonly latencyMs?: number; readonly failFrom?: number } = {},
): readonly ChainedRecord<EvidenceSpan>[] => {
  const chain = new HashChain<EvidenceSpan>()
  return [
    chain.append(modelSpan(id, opts.tokens ?? 50)),
    ...tools.map((tool, index) =>
      chain.append(toolSpan(id, tool, index, opts.failFrom !== undefined && index >= opts.failFrom ? 'error' : 'value', opts.latencyMs ?? 100)),
    ),
  ]
}

describe('synthesize', () => {
  it('detects planted patterns, graph edges, and anomalies in a 50-run fixture', () => {
    const runs: readonly (readonly ChainedRecord<EvidenceSpan>[])[] = [
      ...Array.from({ length: 30 }, (_v, i) => run(`p1-${i}`, ['search', 'lookup', 'respond'])),
      ...Array.from({ length: 15 }, (_v, i) => run(`p2-${i}`, ['search', 'rank', 'respond'])),
      ...Array.from({ length: 4 }, (_v, i) => run(`p3-${i}`, ['ingest', 'classify', 'respond'])),
      run('anomaly-1', ['search', 'fail-a', 'fail-b', 'fail-c', 'respond'], { tokens: 500, latencyMs: 1000, failFrom: 1 }),
    ]

    const insights = synthesize({ runs })
    expect(insights.toolCallGraph.nodes.map((n) => n.toolName)).toEqual(
      expect.arrayContaining(['search', 'lookup', 'rank', 'respond']),
    )
    expect(insights.toolCallGraph.edges).toContainEqual(
      expect.objectContaining({ fromTool: 'search', toTool: 'lookup', transitionCount: 30 }),
    )
    expect(insights.emergentPatterns.slice(0, 3).map((p) => p.pattern.join('>'))).toEqual([
      'search>lookup>respond',
      'search>rank>respond',
      'ingest>classify>respond',
    ])
    expect(insights.anomalies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ runId: 'anomaly-1', kind: 'unusual_path' }),
        expect.objectContaining({ runId: 'anomaly-1', kind: 'cost_spike' }),
        expect.objectContaining({ runId: 'anomaly-1', kind: 'latency_spike' }),
        expect.objectContaining({ runId: 'anomaly-1', kind: 'failure_burst' }),
      ]),
    )
    expect(insights.trends).toHaveLength(3)
    expect(insights.trends[0]?.perBucket[0]?.value).toBeGreaterThan(0)
  })

  it('handles an empty corpus', () => {
    const insights = synthesize({ runs: [] })
    expect(insights.toolCallGraph.nodes).toHaveLength(0)
    expect(insights.emergentPatterns).toHaveLength(0)
    expect(insights.anomalies).toHaveLength(0)
  })

  it('filters by agent definition fingerprint', () => {
    const a = new HashChain<EvidenceSpan>()
    const b = new HashChain<EvidenceSpan>()
    const insights = synthesize({
      runs: [
        [a.append(fingerprintSpan('run-a', 'fp-a')), ...run('run-a', ['search'])],
        [b.append(fingerprintSpan('run-b', 'fp-b')), ...run('run-b', ['lookup'])],
      ],
      agentDefinitionFingerprint: 'fp-a',
    })
    expect(insights.toolCallGraph.nodes.map((n) => n.toolName)).toEqual(['search'])
  })

  it('marks repeated self-transitions as loops', () => {
    const insights = synthesize({ runs: [run('loop-run', ['search', 'search', 'respond'])] })
    expect(insights.toolCallGraph.edges).toContainEqual(
      expect.objectContaining({ fromTool: 'search', toTool: 'search', isLoop: true }),
    )
  })

  it('includes approved tool execution spans in the graph', () => {
    const chain = new HashChain<EvidenceSpan>()
    const approved = { ...toolSpan('approved-run', 'candidate-record', 0, 'value', 100), span: 'tool.execute.approved' }
    const insights = synthesize({ runs: [[chain.append(approved)]] })
    expect(insights.toolCallGraph.nodes.map((n) => n.toolName)).toEqual(['candidate-record'])
  })
})
