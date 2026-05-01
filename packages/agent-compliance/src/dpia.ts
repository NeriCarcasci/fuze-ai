import type {
  AgentDefinition,
  AnnexIIIDomain,
  AnyFuzeTool,
  DataClassification,
  GdprLawfulBasis,
  Residency,
  RetentionPolicy,
} from '@fuze-ai/agent'

export type DpiaRiskKind =
  | 'special-category-data'
  | 'automated-decision'
  | 'high-risk-domain'
  | 'cross-border-transfer'

export interface DpiaRisk {
  readonly kind: DpiaRiskKind
  readonly description: string
  readonly toolNames?: readonly string[]
}

export interface DpiaToolEntry {
  readonly name: string
  readonly description: string
  readonly dataClassification: DataClassification
  readonly residencyRequired: Residency | 'n/a'
  readonly allowedLawfulBases: readonly GdprLawfulBasis[] | 'inherit'
}

export interface DpiaSubProcessor {
  readonly name: string
  readonly role: string
  readonly residency: Residency
}

export interface DpiaDocument {
  readonly version: '1'
  readonly purpose: string
  readonly lawfulBasis: GdprLawfulBasis
  readonly tools: readonly DpiaToolEntry[]
  readonly residencySummary: {
    readonly euOnlyToolCount: number
    readonly euApprovedToolCount: number
    readonly anyResidencyToolCount: number
  }
  readonly annexIIIDomain: AnnexIIIDomain
  readonly producesArt22Decision: boolean
  readonly oversightPlanRef: { readonly id: string; readonly trainingId?: string } | null
  readonly retention: RetentionPolicy
  readonly subProcessors: readonly DpiaSubProcessor[]
  readonly risks: readonly DpiaRisk[]
}

const toolEntry = (t: AnyFuzeTool): DpiaToolEntry => {
  if (t.dataClassification === 'public') {
    return {
      name: t.name,
      description: t.description,
      dataClassification: 'public',
      residencyRequired: 'n/a',
      allowedLawfulBases: t.allowedLawfulBases ?? 'inherit',
    }
  }
  return {
    name: t.name,
    description: t.description,
    dataClassification: t.dataClassification,
    residencyRequired: t.residencyRequired,
    allowedLawfulBases: t.allowedLawfulBases,
  }
}

const toolResidency = (t: AnyFuzeTool): Residency | 'n/a' => {
  if (t.dataClassification === 'public') return 'n/a'
  return t.residencyRequired
}

const detectRisks = (def: AgentDefinition<unknown, unknown>): DpiaRisk[] => {
  const risks: DpiaRisk[] = []

  const specialTools = def.tools.filter((t) => t.dataClassification === 'special-category')
  if (specialTools.length > 0) {
    risks.push({
      kind: 'special-category-data',
      description: 'One or more tools process Article 9 special-category personal data.',
      toolNames: specialTools.map((t) => t.name),
    })
  }

  if (def.producesArt22Decision) {
    risks.push({
      kind: 'automated-decision',
      description:
        'Agent produces decisions with legal or similarly significant effects under GDPR Article 22; human oversight and contest mechanisms required.',
    })
  }

  if (def.annexIIIDomain !== 'none') {
    risks.push({
      kind: 'high-risk-domain',
      description: `Agent operates in EU AI Act Annex III high-risk domain: ${def.annexIIIDomain}.`,
    })
  }

  const nonEuTools = def.tools.filter((t) => {
    const r = toolResidency(t)
    return r === 'any' || r === 'eu-approved'
  })
  if (nonEuTools.length > 0) {
    risks.push({
      kind: 'cross-border-transfer',
      description:
        'Tools permit data residency outside EU-only; ensure adequacy decision, SCCs, or other Chapter V transfer mechanism applies.',
      toolNames: nonEuTools.map((t) => t.name),
    })
  }

  return risks
}

export const generateDpia = (definition: AgentDefinition<unknown, unknown>): DpiaDocument => {
  const tools = definition.tools.map(toolEntry)
  let euOnly = 0
  let euApproved = 0
  let any = 0
  for (const t of definition.tools) {
    const r = toolResidency(t)
    if (r === 'eu') euOnly++
    else if (r === 'eu-approved') euApproved++
    else if (r === 'any') any++
  }

  return {
    version: '1',
    purpose: definition.purpose,
    lawfulBasis: definition.lawfulBasis,
    tools,
    residencySummary: {
      euOnlyToolCount: euOnly,
      euApprovedToolCount: euApproved,
      anyResidencyToolCount: any,
    },
    annexIIIDomain: definition.annexIIIDomain,
    producesArt22Decision: definition.producesArt22Decision,
    oversightPlanRef: definition.art14OversightPlan
      ? {
          id: definition.art14OversightPlan.id,
          ...(definition.art14OversightPlan.trainingId !== undefined
            ? { trainingId: definition.art14OversightPlan.trainingId }
            : {}),
        }
      : null,
    retention: definition.retention,
    subProcessors: [],
    risks: detectRisks(definition),
  }
}
