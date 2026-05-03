import { createHash } from 'node:crypto'
import { canonicalize } from '@fuze-ai/agent'
import { compileAnnexIV, type AnnexIVInput, type AnnexIVReport } from '@fuze-ai/agent-annex-iv'
import { compileFRIA, type FRIAInput, type FRIAReport } from '@fuze-ai/agent-fria'
import { compileIncidentReport, type IncidentInput, type IncidentReport } from '@fuze-ai/agent-incident'

export type ReportKind = 'annex-iv' | 'fria' | 'incident'

export interface CompileReportInput {
  readonly kind: ReportKind
  readonly annexIV?: AnnexIVInput
  readonly fria?: FRIAInput
  readonly incident?: IncidentInput
}

export interface CompiledReport {
  readonly kind: ReportKind
  readonly pdf: Buffer
  readonly json: AnnexIVReport | FRIAReport | IncidentReport
  readonly generatedAt: Date
  readonly contentHash: string
}

const hashJson = (json: AnnexIVReport | FRIAReport | IncidentReport): string =>
  createHash('sha256').update(canonicalize(json)).digest('hex')

export const compileReport = async (input: CompileReportInput): Promise<CompiledReport> => {
  const generatedAt = new Date()
  if (input.kind === 'annex-iv') {
    if (!input.annexIV) throw new Error('compileReport: annexIV input is required for kind annex-iv')
    const compiled = compileAnnexIV(input.annexIV)
    return { kind: input.kind, pdf: compiled.pdf, json: compiled.json, generatedAt, contentHash: hashJson(compiled.json) }
  }
  if (input.kind === 'fria') {
    if (!input.fria) throw new Error('compileReport: fria input is required for kind fria')
    const compiled = compileFRIA(input.fria)
    return { kind: input.kind, pdf: compiled.pdf, json: compiled.json, generatedAt, contentHash: hashJson(compiled.json) }
  }
  if (!input.incident) throw new Error('compileReport: incident input is required for kind incident')
  const compiled = compileIncidentReport(input.incident)
  return { kind: input.kind, pdf: compiled.pdf, json: compiled.json, generatedAt, contentHash: hashJson(compiled.json) }
}
