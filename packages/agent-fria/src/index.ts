import { createRequire } from 'node:module'

export type AnnexIIICategory =
  | 'employment_screening'
  | 'credit_scoring'
  | 'biometric_id'
  | 'education_access'
  | 'essential_services'
  | 'law_enforcement'
  | 'migration_asylum'
  | 'justice_democratic'

export type FundamentalRightArea =
  | 'human_dignity'
  | 'equality_non_discrimination'
  | 'privacy_data_protection'
  | 'freedom_expression_information'
  | 'effective_remedy_fair_trial'
  | 'workers_rights'
  | 'child_vulnerable_groups'

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'
export type Likelihood = 'unlikely' | 'possible' | 'likely' | 'almost_certain'

export interface DataFlow {
  readonly name: string
  readonly description: string
  readonly dataClassification: 'public' | 'business' | 'personal' | 'special-category'
  readonly sourceOrRecipient: string
  readonly lawfulBasis?: string
  readonly retentionPolicy?: string
}

export interface FRIASection {
  readonly area: FundamentalRightArea
  readonly applicable: boolean
  readonly identifiedRisk: string
  readonly severity: RiskLevel
  readonly likelihood: Likelihood
  readonly mitigation: string
  readonly residualRisk: RiskLevel
}

export interface MitigationMeasure {
  readonly id: string
  readonly description: string
  readonly owner: string
  readonly dueDate?: Date
  readonly status: 'planned' | 'implemented' | 'verified'
}

export interface MonitoringMeasure {
  readonly id: string
  readonly metric: string
  readonly cadence: string
  readonly threshold: string
  readonly owner: string
}

export interface FRIAInput {
  readonly systemDescription: {
    readonly name: string
    readonly purpose: string
    readonly intendedUsers: readonly string[]
    readonly affectedPopulation: readonly string[]
  }
  readonly annexIIICategory: AnnexIIICategory
  readonly dataFlows: { readonly input: readonly DataFlow[]; readonly output: readonly DataFlow[] }
  readonly fundamentalRightsAssessment: readonly FRIASection[]
  readonly mitigations: readonly MitigationMeasure[]
  readonly monitoringPlan: readonly MonitoringMeasure[]
  readonly signOff: { readonly name: string; readonly role: string; readonly date: Date }
}

export interface FRIAReport {
  readonly version: '1'
  readonly articleRefs: readonly string[]
  readonly systemDescription: FRIAInput['systemDescription']
  readonly annexIIICategory: AnnexIIICategory
  readonly dataFlows: { readonly input: readonly DataFlow[]; readonly output: readonly DataFlow[] }
  readonly fundamentalRightsAssessment: readonly FRIASection[]
  readonly mitigations: readonly MitigationMeasure[]
  readonly monitoringPlan: readonly MonitoringMeasure[]
  readonly signOff: { readonly name: string; readonly role: string; readonly date: string }
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

const areaTitles: Readonly<Record<FundamentalRightArea, string>> = {
  human_dignity: 'Human dignity',
  equality_non_discrimination: 'Equality and non-discrimination',
  privacy_data_protection: 'Privacy and data protection',
  freedom_expression_information: 'Freedom of expression and information',
  effective_remedy_fair_trial: 'Effective remedy and fair trial',
  workers_rights: "Workers' rights",
  child_vulnerable_groups: 'Rights of the child / vulnerable groups',
}

const rightsAreas = Object.keys(areaTitles) as readonly FundamentalRightArea[]

const risksByCategory: Readonly<Record<AnnexIIICategory, Readonly<Record<FundamentalRightArea, string>>>> = {
  employment_screening: {
    human_dignity: 'Candidate experience may become opaque or demeaning if automated screening is unexplained.',
    equality_non_discrimination: 'Historic hiring data may encode protected-characteristic proxies.',
    privacy_data_protection: 'CVs and assessment data include personal data requiring minimisation.',
    freedom_expression_information: 'Candidates may self-censor if screening criteria are not transparent.',
    effective_remedy_fair_trial: 'Rejected candidates need a meaningful route to contest outcomes.',
    workers_rights: 'Employment access and worker representation interests may be affected.',
    child_vulnerable_groups: 'Young applicants or vulnerable jobseekers may be disproportionately affected.',
  },
  credit_scoring: {
    human_dignity: 'Automated affordability judgements may affect autonomy and financial dignity.',
    equality_non_discrimination: 'Credit features may proxy protected characteristics or postcode bias.',
    privacy_data_protection: 'Financial and behavioural data requires strict purpose limitation.',
    freedom_expression_information: 'Applicants need intelligible information about decision factors.',
    effective_remedy_fair_trial: 'Applicants need correction, appeal, and human review routes.',
    workers_rights: 'Not generally applicable unless credit is tied to employment benefits.',
    child_vulnerable_groups: 'Vulnerable borrowers may face disproportionate exclusion.',
  },
  biometric_id: {
    human_dignity: 'Biometric enrolment can feel coercive in constrained settings.',
    equality_non_discrimination: 'False match rates may vary across demographic groups.',
    privacy_data_protection: 'Biometric templates are special-category data requiring heightened controls.',
    freedom_expression_information: 'Identification may chill participation in monitored spaces.',
    effective_remedy_fair_trial: 'False matches need rapid correction and evidence access.',
    workers_rights: 'Workplace biometric use may affect employee monitoring rights.',
    child_vulnerable_groups: 'Children and vulnerable groups require stronger alternatives and consent handling.',
  },
  education_access: {
    human_dignity: 'Learners may be reduced to risk scores without context.',
    equality_non_discrimination: 'Prior attainment data can amplify socioeconomic disparities.',
    privacy_data_protection: 'Education records require minimisation and role-based access.',
    freedom_expression_information: 'Students need clear information about automated support decisions.',
    effective_remedy_fair_trial: 'Admissions or access outcomes need appeal routes.',
    workers_rights: 'Not generally applicable unless staff allocation is affected.',
    child_vulnerable_groups: 'Children are a primary affected group and need child-specific safeguards.',
  },
  essential_services: {
    human_dignity: 'Service denial may affect basic living standards.',
    equality_non_discrimination: 'Eligibility data may proxy protected status.',
    privacy_data_protection: 'Sensitive household and vulnerability data may be processed.',
    freedom_expression_information: 'Affected people need accessible explanations.',
    effective_remedy_fair_trial: 'Rapid contestability is needed for essential service decisions.',
    workers_rights: 'May apply where worker benefits are affected.',
    child_vulnerable_groups: 'Vulnerable recipients may experience heightened harm from disruption.',
  },
  law_enforcement: {
    human_dignity: 'Law-enforcement use can affect bodily autonomy and dignity.',
    equality_non_discrimination: 'Disparate policing patterns may be amplified.',
    privacy_data_protection: 'Criminal justice data requires strict access and retention controls.',
    freedom_expression_information: 'Surveillance can chill assembly and expression.',
    effective_remedy_fair_trial: 'Evidence use must be contestable and auditable.',
    workers_rights: 'Not generally applicable.',
    child_vulnerable_groups: 'Minors and vulnerable persons require heightened safeguards.',
  },
  migration_asylum: {
    human_dignity: 'Automated triage may affect vulnerable applicants in high-stakes contexts.',
    equality_non_discrimination: 'Nationality and language features can create discrimination risk.',
    privacy_data_protection: 'Migration files contain sensitive personal and family data.',
    freedom_expression_information: 'Applicants need language-accessible information.',
    effective_remedy_fair_trial: 'Asylum and migration outcomes require effective appeal routes.',
    workers_rights: 'May apply where work permission is affected.',
    child_vulnerable_groups: 'Children and vulnerable applicants require specific safeguards.',
  },
  justice_democratic: {
    human_dignity: 'Judicial or civic automation may affect personal autonomy.',
    equality_non_discrimination: 'Civic data may encode exclusion patterns.',
    privacy_data_protection: 'Case and political data require strict confidentiality.',
    freedom_expression_information: 'Democratic participation may be chilled by opaque targeting.',
    effective_remedy_fair_trial: 'Fair trial and administrative remedy safeguards are central.',
    workers_rights: 'Not generally applicable unless workplace rights proceedings are affected.',
    child_vulnerable_groups: 'Vulnerable litigants or young voters require accessible safeguards.',
  },
}

const defaultSection = (area: FundamentalRightArea, category: AnnexIIICategory): FRIASection => ({
  area,
  applicable: area !== 'workers_rights' || category === 'employment_screening',
  identifiedRisk: risksByCategory[category][area],
  severity: area === 'privacy_data_protection' || area === 'equality_non_discrimination' ? 'high' : 'medium',
  likelihood: 'possible',
  mitigation: 'Human oversight, documented explanation, appeal route, access control, and periodic bias review.',
  residualRisk: 'low',
})

export const friaTemplate = (category: AnnexIIICategory): Partial<FRIAInput> => ({
  annexIIICategory: category,
  fundamentalRightsAssessment: rightsAreas.map((area) => defaultSection(area, category)),
  mitigations: [
    { id: 'mitigation-human-review', description: 'Human review before adverse high-impact outcomes.', owner: 'Compliance', status: 'planned' },
    { id: 'mitigation-appeals', description: 'Documented notice, contestability, and correction process.', owner: 'Operations', status: 'planned' },
  ],
  monitoringPlan: [
    { id: 'monitor-disparity', metric: 'Outcome disparity by protected proxy review group', cadence: 'monthly', threshold: 'material unexplained variance', owner: 'Risk' },
    { id: 'monitor-appeals', metric: 'Appeal rate and overturn rate', cadence: 'monthly', threshold: 'sustained increase over baseline', owner: 'Operations' },
  ],
})

const buildReport = (input: FRIAInput): FRIAReport => ({
  version: '1',
  articleRefs: ['Article 27', 'Annex III', 'Article 14', 'Article 15'],
  systemDescription: input.systemDescription,
  annexIIICategory: input.annexIIICategory,
  dataFlows: input.dataFlows,
  fundamentalRightsAssessment: input.fundamentalRightsAssessment,
  mitigations: input.mitigations,
  monitoringPlan: input.monitoringPlan,
  signOff: { name: input.signOff.name, role: input.signOff.role, date: input.signOff.date.toISOString() },
  generatedAt: new Date().toISOString(),
})

const render = (report: FRIAReport): Buffer => {
  const PDFDocument = pdfCtor()
  const doc = new PDFDocument({ size: 'A4', margin: 48 })
  const chunks: Buffer[] = []
  let error: Error | null = null
  doc.on('readable', () => undefined)
  doc.on('error', (err) => {
    error = err
  })
  doc.on('end', () => undefined)

  doc.font('Helvetica-Bold').fontSize(20).text('Fundamental Rights Impact Assessment')
  doc.font('Helvetica').fontSize(10).text('EU AI Act Article 27 regulatory submission')
  doc.moveDown(0.75)
  doc.fontSize(12).text(`System: ${report.systemDescription.name}`)
  doc.text(`Purpose: ${report.systemDescription.purpose}`)
  doc.text(`Annex III category: ${report.annexIIICategory}`)
  doc.text(`Intended users: ${report.systemDescription.intendedUsers.join(', ')}`)
  doc.text(`Affected population: ${report.systemDescription.affectedPopulation.join(', ')}`)
  doc.text(`Sign-off: ${report.signOff.name}, ${report.signOff.role}, ${report.signOff.date}`)

  doc.addPage()
  doc.font('Helvetica-Bold').fontSize(15).text('Data flows')
  doc.font('Helvetica').fontSize(9)
  for (const flow of [...report.dataFlows.input, ...report.dataFlows.output]) {
    doc.text(`- ${flow.name} [${flow.dataClassification}] ${flow.sourceOrRecipient}: ${flow.description}`)
  }

  for (const section of report.fundamentalRightsAssessment) {
    doc.addPage()
    doc.font('Helvetica-Bold').fontSize(14).text(areaTitles[section.area])
    doc.font('Helvetica').fontSize(9).text('References: Article 27, Article 14, Article 15')
    doc.moveDown(0.5)
    doc.fontSize(10).text(`Applicable: ${section.applicable ? 'yes' : 'no'}`)
    doc.text(`Identified risk: ${section.identifiedRisk}`)
    doc.text(`Severity: ${section.severity}`)
    doc.text(`Likelihood: ${section.likelihood}`)
    doc.text(`Mitigation: ${section.mitigation}`)
    doc.text(`Residual risk: ${section.residualRisk}`)
  }

  doc.addPage()
  doc.font('Helvetica-Bold').fontSize(15).text('Mitigations and monitoring')
  doc.font('Helvetica').fontSize(9)
  for (const mitigation of report.mitigations) {
    doc.text(`- ${mitigation.id}: ${mitigation.description}; owner=${mitigation.owner}; status=${mitigation.status}`)
  }
  doc.moveDown(0.5)
  for (const measure of report.monitoringPlan) {
    doc.text(`- ${measure.id}: ${measure.metric}; cadence=${measure.cadence}; threshold=${measure.threshold}; owner=${measure.owner}`)
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

export const compileFRIA = (input: FRIAInput): { readonly pdf: Buffer; readonly json: FRIAReport } => {
  const json = buildReport(input)
  return { pdf: render(json), json }
}
