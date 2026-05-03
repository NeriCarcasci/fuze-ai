import type { ChainedRecord, EvidenceSpan } from '@fuze-ai/agent'

export interface SynthesisInput {
  readonly runs: readonly (readonly ChainedRecord<EvidenceSpan>[])[]
  readonly agentDefinitionFingerprint?: string
}

export interface WorkflowInsights {
  readonly toolCallGraph: {
    readonly nodes: readonly { readonly toolName: string; readonly callCount: number; readonly failureRate: number; readonly avgLatencyMs: number; readonly tokensTotal: number }[]
    readonly edges: readonly { readonly fromTool: string; readonly toTool: string; readonly transitionCount: number; readonly isLoop: boolean }[]
  }
  readonly emergentPatterns: readonly {
    readonly pattern: readonly string[]
    readonly runCount: number
    readonly avgDurationMs: number
    readonly representativeRunIds: readonly string[]
  }[]
  readonly anomalies: readonly {
    readonly runId: string
    readonly kind: 'unusual_path' | 'cost_spike' | 'latency_spike' | 'failure_burst'
    readonly severity: 'low' | 'medium' | 'high'
    readonly description: string
  }[]
  readonly trends: readonly {
    readonly metric: 'tokens_per_run' | 'latency_p95' | 'failure_rate'
    readonly perBucket: readonly { readonly from: Date; readonly to: Date; readonly value: number }[]
  }[]
}

interface RunSummary {
  readonly runId: string
  readonly sequence: readonly string[]
  readonly durationMs: number
  readonly tokens: number
  readonly p95LatencyMs: number
  readonly failureRate: number
  readonly hasFailureBurst: boolean
  readonly startedAt: Date
  readonly toolSpans: readonly EvidenceSpan[]
}

const attrString = (span: EvidenceSpan, key: string): string | null => {
  const value = span.attrs[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

const attrNumber = (span: EvidenceSpan, key: string): number => {
  const value = span.attrs[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

const durationMs = (span: EvidenceSpan): number => {
  const started = Date.parse(span.startedAt)
  const ended = Date.parse(span.endedAt)
  if (!Number.isFinite(started) || !Number.isFinite(ended)) return 0
  return Math.max(0, ended - started)
}

const percentile = (values: readonly number[], p: number): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index] ?? 0
}

const median = (values: readonly number[]): number => percentile(values, 50)

const severityFor = (ratio: number): 'low' | 'medium' | 'high' => {
  if (ratio >= 4) return 'high'
  if (ratio >= 3) return 'medium'
  return 'low'
}

const runMatchesFingerprint = (run: readonly ChainedRecord<EvidenceSpan>[], fingerprint?: string): boolean => {
  if (!fingerprint) return true
  return run.some((r) => r.payload.attrs['fuze.agent.definition_fingerprint'] === fingerprint)
}

const summarizeRun = (records: readonly ChainedRecord<EvidenceSpan>[]): RunSummary => {
  const spans = records.map((r) => r.payload)
  const toolSpans = spans.filter((s) => s.span.startsWith('tool.execute'))
  const sequence = toolSpans.map((s) => attrString(s, 'gen_ai.tool.name') ?? 'unknown')
  const first = spans[0]
  const last = spans[spans.length - 1]
  const startMs = first ? Date.parse(first.startedAt) : Date.now()
  const endMs = last ? Date.parse(last.endedAt) : startMs
  let consecutiveFailures = 0
  let hasFailureBurst = false
  let failed = 0
  for (const span of toolSpans) {
    const ok = attrString(span, 'fuze.tool.outcome') === 'value'
    if (ok) {
      consecutiveFailures = 0
    } else {
      failed++
      consecutiveFailures++
      if (consecutiveFailures >= 3) hasFailureBurst = true
    }
  }
  return {
    runId: spans[0]?.runId ?? 'unknown-run',
    sequence,
    durationMs: Math.max(0, endMs - startMs),
    tokens: spans.reduce((sum, s) => sum + attrNumber(s, 'gen_ai.usage.input_tokens') + attrNumber(s, 'gen_ai.usage.output_tokens'), 0),
    p95LatencyMs: percentile(toolSpans.map(durationMs), 95),
    failureRate: toolSpans.length === 0 ? 0 : failed / toolSpans.length,
    hasFailureBurst,
    startedAt: new Date(Number.isFinite(startMs) ? startMs : 0),
    toolSpans,
  }
}

const graph = (summaries: readonly RunSummary[]): WorkflowInsights['toolCallGraph'] => {
  const nodes = new Map<string, { calls: number; failures: number; latency: number; tokens: number }>()
  const edges = new Map<string, { from: string; to: string; count: number; loop: boolean }>()
  for (const summary of summaries) {
    const firstIndex = new Map<string, number>()
    summary.sequence.forEach((tool, index) => {
      if (!firstIndex.has(tool)) firstIndex.set(tool, index)
    })
    for (const span of summary.toolSpans) {
      const tool = attrString(span, 'gen_ai.tool.name') ?? 'unknown'
      const current = nodes.get(tool) ?? { calls: 0, failures: 0, latency: 0, tokens: 0 }
      nodes.set(tool, {
        calls: current.calls + 1,
        failures: current.failures + (attrString(span, 'fuze.tool.outcome') === 'value' ? 0 : 1),
        latency: current.latency + durationMs(span),
        tokens: current.tokens + attrNumber(span, 'gen_ai.usage.input_tokens') + attrNumber(span, 'gen_ai.usage.output_tokens'),
      })
    }
    for (let i = 0; i < summary.sequence.length - 1; i++) {
      const from = summary.sequence[i]
      const to = summary.sequence[i + 1]
      if (!from || !to) continue
      const key = `${from}\u0000${to}`
      const priorTo = firstIndex.get(to) ?? i + 1
      const loop = from === to || priorTo < i
      const current = edges.get(key) ?? { from, to, count: 0, loop: false }
      edges.set(key, { from, to, count: current.count + 1, loop: current.loop || loop })
    }
  }
  return {
    nodes: [...nodes.entries()]
      .map(([toolName, n]) => ({
        toolName,
        callCount: n.calls,
        failureRate: n.calls === 0 ? 0 : n.failures / n.calls,
        avgLatencyMs: n.calls === 0 ? 0 : n.latency / n.calls,
        tokensTotal: n.tokens,
      }))
      .sort((a, b) => a.toolName.localeCompare(b.toolName)),
    edges: [...edges.values()]
      .map((e) => ({ fromTool: e.from, toTool: e.to, transitionCount: e.count, isLoop: e.loop }))
      .sort((a, b) => a.fromTool.localeCompare(b.fromTool) || a.toTool.localeCompare(b.toTool)),
  }
}

const patterns = (summaries: readonly RunSummary[]): WorkflowInsights['emergentPatterns'] => {
  const groups = new Map<string, RunSummary[]>()
  for (const summary of summaries) {
    const key = summary.sequence.join('>')
    groups.set(key, [...(groups.get(key) ?? []), summary])
  }
  return [...groups.entries()]
    .map(([key, group]) => ({
      pattern: key.length === 0 ? [] : key.split('>'),
      runCount: group.length,
      avgDurationMs: group.reduce((sum, r) => sum + r.durationMs, 0) / group.length,
      representativeRunIds: group.slice(0, 3).map((r) => r.runId),
    }))
    .sort((a, b) => b.runCount - a.runCount || a.pattern.join('>').localeCompare(b.pattern.join('>')))
    .slice(0, 10)
}

const anomalies = (summaries: readonly RunSummary[]): WorkflowInsights['anomalies'] => {
  const out: WorkflowInsights['anomalies'][number][] = []
  const total = summaries.length
  const sequenceCounts = new Map<string, number>()
  for (const summary of summaries) sequenceCounts.set(summary.sequence.join('>'), (sequenceCounts.get(summary.sequence.join('>')) ?? 0) + 1)
  const tokenMedian = median(summaries.map((s) => s.tokens))
  const latencyMedian = median(summaries.map((s) => s.p95LatencyMs))
  for (const summary of summaries) {
    const sequenceKey = summary.sequence.join('>')
    const sequenceShare = total === 0 ? 0 : (sequenceCounts.get(sequenceKey) ?? 0) / total
    if (sequenceShare < 0.05) {
      out.push({ runId: summary.runId, kind: 'unusual_path', severity: 'medium', description: `Tool sequence appears in ${Math.round(sequenceShare * 100)}% of runs.` })
    }
    if (tokenMedian > 0 && summary.tokens > tokenMedian * 2) {
      out.push({ runId: summary.runId, kind: 'cost_spike', severity: severityFor(summary.tokens / tokenMedian), description: `Tokens ${summary.tokens} exceed 2x median ${tokenMedian}.` })
    }
    if (latencyMedian > 0 && summary.p95LatencyMs > latencyMedian * 2) {
      out.push({ runId: summary.runId, kind: 'latency_spike', severity: severityFor(summary.p95LatencyMs / latencyMedian), description: `Latency p95 ${summary.p95LatencyMs}ms exceeds 2x median ${latencyMedian}ms.` })
    }
    if (summary.hasFailureBurst) {
      out.push({ runId: summary.runId, kind: 'failure_burst', severity: 'high', description: 'Run contains at least three failed tool calls in a row.' })
    }
  }
  return out
}

const dayKey = (date: Date): string => date.toISOString().slice(0, 10)

const bucketed = (summaries: readonly RunSummary[], metric: WorkflowInsights['trends'][number]['metric']): WorkflowInsights['trends'][number] => {
  const buckets = new Map<string, RunSummary[]>()
  for (const summary of summaries) buckets.set(dayKey(summary.startedAt), [...(buckets.get(dayKey(summary.startedAt)) ?? []), summary])
  return {
    metric,
    perBucket: [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, bucket]) => {
        const from = new Date(`${key}T00:00:00.000Z`)
        const to = new Date(`${key}T23:59:59.999Z`)
        const value =
          metric === 'tokens_per_run'
            ? bucket.reduce((sum, r) => sum + r.tokens, 0) / bucket.length
            : metric === 'latency_p95'
              ? percentile(bucket.map((r) => r.p95LatencyMs), 95)
              : bucket.reduce((sum, r) => sum + r.failureRate, 0) / bucket.length
        return { from, to, value }
      }),
  }
}

export const synthesize = (input: SynthesisInput): WorkflowInsights => {
  const summaries = input.runs
    .filter((run) => runMatchesFingerprint(run, input.agentDefinitionFingerprint))
    .map(summarizeRun)
  return {
    toolCallGraph: graph(summaries),
    emergentPatterns: patterns(summaries),
    anomalies: anomalies(summaries),
    trends: [
      bucketed(summaries, 'tokens_per_run'),
      bucketed(summaries, 'latency_p95'),
      bucketed(summaries, 'failure_rate'),
    ],
  }
}
