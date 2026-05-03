import { createRequire } from 'node:module'
import type { AnnexIVInput, AnnexIVReport, AnnexIVSectionReport, DeclaredRole } from './types.js'

interface PdfDocLike {
  fontSize(size: number): PdfDocLike
  font(name: string): PdfDocLike
  text(text: string, options?: Readonly<Record<string, unknown>>): PdfDocLike
  moveDown(lines?: number): PdfDocLike
  addPage(): PdfDocLike
  on(event: 'readable', listener: () => void): PdfDocLike
  on(event: 'end', listener: () => void): PdfDocLike
  on(event: 'error', listener: (err: Error) => void): PdfDocLike
  read(): Buffer | null
  end(): void
}

type PdfCtor = new (opts?: Readonly<Record<string, unknown>>) => PdfDocLike

const require = createRequire(import.meta.url)

const getPdfCtor = (): PdfCtor => {
  const loaded: unknown = require('pdfkit')
  if (typeof loaded === 'function') return loaded as PdfCtor
  if (loaded && typeof loaded === 'object' && 'default' in loaded) {
    const candidate = (loaded as { readonly default?: unknown }).default
    if (typeof candidate === 'function') return candidate as PdfCtor
  }
  throw new Error('pdfkit could not be loaded')
}

const iso = (d: Date): string => d.toISOString()

const durationMs = (startedAt: string, endedAt: string): number => {
  const started = Date.parse(startedAt)
  const ended = Date.parse(endedAt)
  if (!Number.isFinite(started) || !Number.isFinite(ended)) return 0
  return Math.max(0, ended - started)
}

const percentile = (values: readonly number[], p: number): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index] ?? 0
}

const attrString = (attrs: Readonly<Record<string, unknown>>, key: string): string | null => {
  const value = attrs[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

const attrNumber = (attrs: Readonly<Record<string, unknown>>, key: string): number => {
  const value = attrs[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

const roles = (input: AnnexIVInput): readonly DeclaredRole[] => {
  const out: DeclaredRole[] = []
  if (input.declaredRoles.deployer) out.push('deployer')
  if (input.declaredRoles.provider) out.push('provider')
  if (input.declaredRoles.component_supplier) out.push('component_supplier')
  return out
}

const unique = (values: readonly string[]): readonly string[] =>
  [...new Set(values.filter((v) => v.length > 0))].sort()

const lastHash = (input: AnnexIVInput): string =>
  input.spans.length === 0 ? '0'.repeat(64) : input.spans[input.spans.length - 1]?.hash ?? '0'.repeat(64)

const truncate = (s: string, head = 18): string => (s.length <= head ? s : `${s.slice(0, head)}...`)

const failureRateByTool = (input: AnnexIVInput): string => {
  const stats = new Map<string, { total: number; failed: number }>()
  for (const record of input.spans) {
    if (!record.payload.span.startsWith('tool.execute')) continue
    const tool = attrString(record.payload.attrs, 'gen_ai.tool.name') ?? 'unknown'
    const current = stats.get(tool) ?? { total: 0, failed: 0 }
    const outcome = attrString(record.payload.attrs, 'fuze.tool.outcome')
    stats.set(tool, {
      total: current.total + 1,
      failed: current.failed + (outcome && outcome !== 'value' ? 1 : 0),
    })
  }
  if (stats.size === 0) return 'no tool executions'
  return [...stats.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tool, stat]) => `${tool}: ${stat.total === 0 ? 0 : Math.round((stat.failed / stat.total) * 100)}%`)
    .join('; ')
}

const buildSections = (input: AnnexIVInput): readonly AnnexIVSectionReport[] => {
  const spans = input.spans.map((r) => r.payload)
  const toolSpans = spans.filter((s) => s.span.startsWith('tool.execute'))
  const guardSpans = spans.filter((s) => s.role === 'guardrail')
  const modelSpans = spans.filter((s) => s.span === 'model.generate')
  const policySpans = spans.filter((s) => s.span === 'policy.evaluate')
  const oversightDurations = input.oversightDecisions
    .map((d) => (d.requestedAt ? Math.max(0, d.decidedAt.getTime() - d.requestedAt.getTime()) : 0))
    .filter((v) => v > 0)
  const decisionsWithRationale = input.oversightDecisions.filter((d) => (d.rationale ?? '').trim().length > 0).length
  const failedTools = toolSpans.filter((s) => attrString(s.attrs, 'fuze.tool.outcome') !== 'value')
  const retrySignals = toolSpans.filter((s) => attrString(s.attrs, 'fuze.tool.outcome') === 'error').length
  const sandboxRefusals = toolSpans.filter((s) => String(s.attrs['fuze.sandbox.refused'] ?? 'false') === 'true').length
  const evals = input.evalResults ?? []
  const incidents = input.incidents ?? []
  const alerts = input.alertDeliveries ?? []
  const classifications = unique(toolSpans.map((s) => attrString(s.attrs, 'fuze.data_classification') ?? 'unknown'))
  const lawfulBases = unique(spans.map((s) => s.common['fuze.lawful_basis'] ?? 'unspecified'))
  const retentionPolicies = unique(spans.map((s) => s.common['fuze.retention.policy_id']))
  const residency = unique(spans.map((s) => attrString(s.attrs, 'fuze.model.residency') ?? '').filter((s) => s.length > 0))
  const trippedGuards = guardSpans.filter((s) => s.attrs['fuze.guardrail.tripped'] === true).length
  const loopSignals = spans.filter((s) => String(s.attrs['fuze.loop.detected'] ?? 'false') === 'true').length
  const killSwitches = spans.filter((s) => String(s.attrs['fuze.kill_switch.triggered'] ?? 'false') === 'true').length
  const chainHead = lastHash(input)
  const signed = input.signedRunRoots[0]

  return [
    {
      id: 'annex-iv-1',
      title: 'General Description',
      articleRefs: ['Annex IV point 1', 'Annex III'],
      summary: `${input.projectName} is declared for roles ${roles(input).join(', ') || 'none'} across ${input.organisation.name}.`,
      metrics: {
        spanCount: spans.length,
        annexIIICategory: unique(spans.map((s) => s.common['fuze.annex_iii_domain'])).join(', ') || 'none',
        producesArt22Decision: spans.some((s) => s.common['fuze.art22_decision']),
      },
      evidence: [
        `Purpose observed: ${unique(spans.map((s) => attrString(s.attrs, 'gen_ai.agent.name') ?? '').filter((s) => s.length > 0)).join(', ') || input.projectName}`,
        `Intended operator window: ${iso(input.dateRange.from)} to ${iso(input.dateRange.to)}`,
      ],
    },
    {
      id: 'annex-iv-2',
      title: 'Data And Data Governance',
      articleRefs: ['Annex IV point 2', 'Article 10'],
      summary: `The evidence stream uses classifications ${classifications.join(', ') || 'none recorded'} and lawful bases ${lawfulBases.join(', ')}.`,
      metrics: {
        classificationCount: classifications.length,
        lawfulBasisCount: lawfulBases.length,
        retentionPolicyCount: retentionPolicies.length,
        residency: residency.join(', ') || 'not recorded',
      },
      evidence: [
        `Retention policies: ${retentionPolicies.join(', ') || 'none'}`,
        `Data residency observations: ${residency.join(', ') || 'none'}`,
      ],
    },
    {
      id: 'annex-iv-3',
      title: 'Logging Capabilities',
      articleRefs: ['Annex IV point 3', 'Article 12'],
      summary: `The report covers ${spans.length} hash-chained spans ending at ${truncate(chainHead)}.`,
      metrics: {
        spanCount: spans.length,
        chainHead,
        signedRunRootCount: input.signedRunRoots.length,
        timeRange: `${iso(input.dateRange.from)} / ${iso(input.dateRange.to)}`,
      },
      evidence: [
        signed ? `Signed run root key ${signed.publicKeyId}, signature ${truncate(signed.signature, 24)}` : 'No signed run root provided',
        `Transparency reference: ${unique(spans.map((s) => attrString(s.attrs, 'fuze.transparency.ref') ?? '').filter((s) => s.length > 0)).join(', ') || 'not applicable'}`,
      ],
    },
    {
      id: 'annex-iv-4',
      title: 'Risk Management',
      articleRefs: ['Annex IV point 4', 'Article 9'],
      summary: `${trippedGuards} guard events, ${loopSignals} loop signals, ${killSwitches} kill-switch events, and ${input.suspendedRuns.length} suspended runs were observed.`,
      metrics: {
        guardEventsTriggered: trippedGuards,
        loopsDetected: loopSignals,
        killSwitchesTriggered: killSwitches,
        suspendedRuns: input.suspendedRuns.length,
      },
      evidence: [
        `Policy evaluations: ${policySpans.length}`,
        `Suspended tools: ${unique(input.suspendedRuns.map((r) => r.toolName)).join(', ') || 'none'}`,
      ],
    },
    {
      id: 'annex-iv-5',
      title: 'Human Oversight',
      articleRefs: ['Annex IV point 5', 'Article 14'],
      summary: `${input.oversightDecisions.length} oversight decisions were recorded with ${input.oversightDecisions.filter((d) => d.action === 'approve').length} approvals and ${input.oversightDecisions.filter((d) => d.action === 'reject').length} rejections.`,
      metrics: {
        approvals: input.oversightDecisions.filter((d) => d.action === 'approve').length,
        rejections: input.oversightDecisions.filter((d) => d.action === 'reject').length,
        rationalePresenceRate: input.oversightDecisions.length === 0 ? 0 : Math.round((decisionsWithRationale / input.oversightDecisions.length) * 100),
        decisionTimeP50Ms: percentile(oversightDurations, 50),
        decisionTimeP95Ms: percentile(oversightDurations, 95),
      },
      evidence: [`Overseer ids: ${unique(input.oversightDecisions.map((d) => d.overseerId ?? '')).join(', ') || 'not recorded'}`],
    },
    {
      id: 'annex-iv-6',
      title: 'Accuracy, Robustness, Security',
      articleRefs: ['Annex IV point 6', 'Article 15'],
      summary: `Tool failure rate by tool: ${failureRateByTool(input)}.`,
      metrics: {
        toolExecutions: toolSpans.length,
        failedToolExecutions: failedTools.length,
        retrySignals,
        sandboxRefusals,
      },
      evidence: [
        `Retry outcomes: ${retrySignals}`,
        `Latency p95 ms: ${percentile(toolSpans.map((s) => durationMs(s.startedAt, s.endedAt)), 95)}`,
      ],
    },
    {
      id: 'annex-iv-7',
      title: 'Quality Management',
      articleRefs: ['Annex IV point 7', 'Article 17'],
      summary: evals.length === 0 ? 'No eval summaries were supplied.' : `${evals.length} eval summaries were supplied.`,
      metrics: {
        evalRunCount: evals.length,
        successRate: evals.length === 0 ? 0 : Math.round((evals.reduce((sum, e) => sum + e.successRate, 0) / evals.length) * 100),
        coverage: evals.length === 0 ? 0 : Math.round((evals.reduce((sum, e) => sum + e.coverage, 0) / evals.length) * 100),
        lastRunTimestamp: evals.map((e) => e.lastRunAt.getTime()).sort((a, b) => b - a)[0] ? iso(new Date(evals.map((e) => e.lastRunAt.getTime()).sort((a, b) => b - a)[0] ?? 0)) : 'none',
      },
      evidence: [`Eval ids: ${evals.map((e) => e.id).join(', ') || 'none'}`],
    },
    {
      id: 'annex-iv-8',
      title: 'Post-Market Monitoring',
      articleRefs: ['Annex IV point 8', 'Article 72', 'Article 73'],
      summary: `${incidents.length} Article 73 incident records and ${alerts.length} alert deliveries were supplied.`,
      metrics: {
        incidents: incidents.length,
        alertDeliveries: alerts.length,
        failedAlertDeliveries: alerts.filter((a) => a.status === 'failed').length,
        regressionSignals: modelSpans.filter((s) => String(s.attrs['fuze.regression.signal'] ?? 'false') === 'true').length,
      },
      evidence: [
        `Recent incidents: ${incidents.map((i) => `${i.id}:${i.severity}`).join(', ') || 'none'}`,
        `Alert channels: ${unique(alerts.map((a) => a.channel)).join(', ') || 'none'}`,
      ],
    },
  ]
}

const buildReport = (input: AnnexIVInput): AnnexIVReport => ({
  version: '1',
  projectId: input.projectId,
  projectName: input.projectName,
  organisation: input.organisation,
  declaredRoles: roles(input),
  dateRange: { from: iso(input.dateRange.from), to: iso(input.dateRange.to) },
  generatedAt: new Date().toISOString(),
  sections: buildSections(input),
})

const metricLines = (metrics: Readonly<Record<string, string | number | boolean>>): readonly string[] =>
  Object.entries(metrics).map(([k, v]) => `${k}: ${String(v)}`)

const renderReport = (report: AnnexIVReport): Buffer => {
  const PDFDocument = getPdfCtor()
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: false })
  const chunks: Buffer[] = []
  let error: Error | null = null
  doc.on('readable', () => undefined)
  doc.on('error', (err) => {
    error = err
  })
  doc.on('end', () => undefined)

  doc.font('Helvetica-Bold').fontSize(20).text('Annex IV Technical Documentation')
  doc.moveDown(0.5)
  doc.font('Helvetica').fontSize(12).text(`Project: ${report.projectName}`)
  doc.text(`Project id: ${report.projectId}`)
  doc.text(`Organisation: ${report.organisation.name}`)
  doc.text(`Address: ${report.organisation.address}`)
  doc.text(`Declared roles: ${report.declaredRoles.join(', ') || 'none'}`)
  doc.text(`Date range: ${report.dateRange.from} to ${report.dateRange.to}`)
  doc.text(`Generated: ${report.generatedAt}`)
  doc.moveDown(1)
  doc.fontSize(10).text('EU AI Act references: Annex III, Annex IV, Articles 9, 10, 12, 14, 15, 17, 72, 73.')

  for (const section of report.sections) {
    doc.addPage()
    doc.font('Helvetica-Bold').fontSize(15).text(`${section.id}. ${section.title}`)
    doc.font('Helvetica').fontSize(9).text(`References: ${section.articleRefs.join(', ')}`)
    doc.moveDown(0.5)
    doc.fontSize(11).text(section.summary)
    doc.moveDown(0.5)
    doc.font('Helvetica-Bold').fontSize(11).text('Metrics')
    doc.font('Helvetica').fontSize(9)
    for (const line of metricLines(section.metrics)) doc.text(`- ${line}`)
    doc.moveDown(0.5)
    doc.font('Helvetica-Bold').fontSize(11).text('Evidence')
    doc.font('Helvetica').fontSize(9)
    for (const line of section.evidence) doc.text(`- ${line}`)
  }

  doc.end()
  let chunk = doc.read()
  while (chunk !== null) {
    chunks.push(chunk)
    chunk = doc.read()
  }
  if (error) throw error
  return Buffer.concat(chunks)
}

export const compileAnnexIV = (input: AnnexIVInput): { readonly pdf: Buffer; readonly json: AnnexIVReport } => {
  const json = buildReport(input)
  return { pdf: renderReport(json), json }
}
