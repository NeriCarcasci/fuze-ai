import { createRequire } from 'node:module'

export type IncidentSeverity = 'serious_harm' | 'significant_disruption' | 'rights_infringement' | 'other'

export interface IncidentInput {
  readonly organisation: { readonly id: string; readonly name: string; readonly contact: string }
  readonly affectedSystems: readonly { readonly id: string; readonly name: string; readonly deploymentDate: Date }[]
  readonly incident: {
    readonly detectedAt: Date
    readonly summary: string
    readonly severity: IncidentSeverity
    readonly affectedPersonsEstimate: number
  }
  readonly rootCause: { readonly description: string; readonly categoryTags: readonly string[] }
  readonly evidenceRefs: {
    readonly runIds: readonly string[]
    readonly chainHeads: readonly string[]
    readonly suspendedRunIds?: readonly string[]
  }
  readonly mitigationsApplied: readonly { readonly description: string; readonly appliedAt: Date }[]
  readonly notifications: readonly { readonly authority: string; readonly submittedAt?: Date; readonly reference?: string }[]
}

export interface IncidentReport {
  readonly version: '1'
  readonly articleRefs: readonly string[]
  readonly organisation: IncidentInput['organisation']
  readonly affectedSystems: readonly { readonly id: string; readonly name: string; readonly deploymentDate: string }[]
  readonly incident: Omit<IncidentInput['incident'], 'detectedAt'> & { readonly detectedAt: string }
  readonly deadline: { readonly hours: number; readonly isoBy: string }
  readonly rootCause: IncidentInput['rootCause']
  readonly evidenceRefs: IncidentInput['evidenceRefs']
  readonly timeline: readonly { readonly at: string; readonly event: string }[]
  readonly mitigationsApplied: readonly { readonly description: string; readonly appliedAt: string }[]
  readonly notifications: readonly { readonly authority: string; readonly submittedAt?: string; readonly reference?: string }[]
  readonly generatedAt: string
}

interface PdfDocLike {
  fontSize(size: number): PdfDocLike
  font(name: string): PdfDocLike
  text(text: string, options?: Readonly<Record<string, unknown>>): PdfDocLike
  moveDown(lines?: number): PdfDocLike
  addPage(): PdfDocLike
  on(event: 'readable', listener: () => void): PdfDocLike
  on(event: 'error', listener: (err: Error) => void): PdfDocLike
  on(event: 'end', listener: () => void): PdfDocLike
  read(): Buffer | null
  end(): void
}

type PdfCtor = new (opts?: Readonly<Record<string, unknown>>) => PdfDocLike
const require = createRequire(import.meta.url)

const pdfCtor = (): PdfCtor => {
  const loaded: unknown = require('pdfkit')
  if (typeof loaded === 'function') return loaded as PdfCtor
  if (loaded && typeof loaded === 'object' && 'default' in loaded) {
    const candidate = (loaded as { readonly default?: unknown }).default
    if (typeof candidate === 'function') return candidate as PdfCtor
  }
  throw new Error('pdfkit could not be loaded')
}

const hoursFor = (severity: IncidentSeverity): number => (severity === 'serious_harm' ? 48 : 360)

export const deadlineFor = (severity: IncidentSeverity): { readonly hours: number; readonly isoBy: string } => {
  const hours = hoursFor(severity)
  return { hours, isoBy: new Date(Date.now() + hours * 60 * 60 * 1000).toISOString() }
}

const deadlineFromDetection = (severity: IncidentSeverity, detectedAt: Date): { readonly hours: number; readonly isoBy: string } => {
  const hours = hoursFor(severity)
  return { hours, isoBy: new Date(detectedAt.getTime() + hours * 60 * 60 * 1000).toISOString() }
}

const buildTimeline = (input: IncidentInput): readonly { readonly at: string; readonly event: string }[] => [
  { at: input.incident.detectedAt.toISOString(), event: 'Incident detected' },
  ...input.mitigationsApplied.map((m) => ({ at: m.appliedAt.toISOString(), event: `Mitigation applied: ${m.description}` })),
  ...input.notifications
    .filter((n) => n.submittedAt !== undefined)
    .map((n) => ({ at: n.submittedAt?.toISOString() ?? input.incident.detectedAt.toISOString(), event: `Notification submitted to ${n.authority}` })),
]

const buildReport = (input: IncidentInput): IncidentReport => ({
  version: '1',
  articleRefs: ['Article 73', 'Article 72', 'Article 12'],
  organisation: input.organisation,
  affectedSystems: input.affectedSystems.map((s) => ({ id: s.id, name: s.name, deploymentDate: s.deploymentDate.toISOString() })),
  incident: { ...input.incident, detectedAt: input.incident.detectedAt.toISOString() },
  deadline: deadlineFromDetection(input.incident.severity, input.incident.detectedAt),
  rootCause: input.rootCause,
  evidenceRefs: input.evidenceRefs,
  timeline: [...buildTimeline(input)].sort((a, b) => a.at.localeCompare(b.at)),
  mitigationsApplied: input.mitigationsApplied.map((m) => ({ description: m.description, appliedAt: m.appliedAt.toISOString() })),
  notifications: input.notifications.map((n) => ({
    authority: n.authority,
    ...(n.submittedAt ? { submittedAt: n.submittedAt.toISOString() } : {}),
    ...(n.reference ? { reference: n.reference } : {}),
  })),
  generatedAt: new Date().toISOString(),
})

const render = (report: IncidentReport): Buffer => {
  const PDFDocument = pdfCtor()
  const doc = new PDFDocument({ size: 'A4', margin: 48 })
  const chunks: Buffer[] = []
  let error: Error | null = null
  doc.on('readable', () => undefined)
  doc.on('error', (err) => {
    error = err
  })
  doc.on('end', () => undefined)

  doc.font('Helvetica-Bold').fontSize(20).text('Article 73 Serious Incident Report')
  doc.font('Helvetica').fontSize(10).text('EU AI Act Articles 73, 72, and 12')
  doc.moveDown(0.75)
  doc.fontSize(11).text(`Organisation: ${report.organisation.name} (${report.organisation.id})`)
  doc.text(`Contact: ${report.organisation.contact}`)
  doc.text(`Detected at: ${report.incident.detectedAt}`)
  doc.text(`Severity: ${report.incident.severity}`)
  doc.text(`Submission deadline: ${report.deadline.isoBy} (${report.deadline.hours} hours)`)
  doc.text(`Affected persons estimate: ${report.incident.affectedPersonsEstimate}`)
  doc.moveDown(0.75)
  doc.text(`Summary: ${report.incident.summary}`)

  doc.addPage()
  doc.font('Helvetica-Bold').fontSize(14).text('Affected systems')
  doc.font('Helvetica').fontSize(9)
  for (const system of report.affectedSystems) doc.text(`- ${system.name} (${system.id}), deployed ${system.deploymentDate}`)

  doc.moveDown(0.5)
  doc.font('Helvetica-Bold').fontSize(14).text('Timeline')
  doc.font('Helvetica').fontSize(9)
  for (const event of report.timeline) doc.text(`- ${event.at}: ${event.event}`)

  doc.addPage()
  doc.font('Helvetica-Bold').fontSize(14).text('Root cause analysis')
  doc.font('Helvetica').fontSize(10).text(report.rootCause.description)
  doc.fontSize(9).text(`Category tags: ${report.rootCause.categoryTags.join(', ')}`)
  doc.moveDown(0.5)
  doc.font('Helvetica-Bold').fontSize(14).text('Evidence references')
  doc.font('Helvetica').fontSize(9)
  doc.text(`Run ids: ${report.evidenceRefs.runIds.join(', ')}`)
  doc.text(`Chain heads: ${report.evidenceRefs.chainHeads.join(', ')}`)
  doc.text(`Suspended run ids: ${report.evidenceRefs.suspendedRunIds?.join(', ') ?? 'none'}`)

  doc.addPage()
  doc.font('Helvetica-Bold').fontSize(14).text('Mitigations')
  doc.font('Helvetica').fontSize(9)
  for (const mitigation of report.mitigationsApplied) doc.text(`- ${mitigation.appliedAt}: ${mitigation.description}`)
  doc.moveDown(0.5)
  doc.font('Helvetica-Bold').fontSize(14).text('Notifications log')
  doc.font('Helvetica').fontSize(9)
  for (const notification of report.notifications) {
    doc.text(`- ${notification.authority}: submitted=${notification.submittedAt ?? 'pending'}; reference=${notification.reference ?? 'pending'}`)
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

export const compileIncidentReport = (input: IncidentInput): { readonly pdf: Buffer; readonly json: IncidentReport } => {
  const json = buildReport(input)
  return { pdf: render(json), json }
}
