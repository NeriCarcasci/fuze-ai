import { z } from 'zod'

const dataClassification = z.enum(['public', 'business', 'personal', 'special-category'])

const lawfulBasis = z.enum([
  'consent',
  'contract',
  'legal-obligation',
  'vital-interests',
  'public-task',
  'legitimate-interests',
])

const annexIIIDomain = z.enum([
  'none',
  'biometric',
  'critical-infrastructure',
  'education',
  'employment',
  'essential-services',
  'law-enforcement',
  'migration',
  'justice',
  'democratic-processes',
])

const spanRole = z.enum(['agent', 'model', 'tool', 'guardrail', 'policy'])

const approvalAction = z.enum(['approve', 'reject', 'halt', 'override'])

export const SpanCommonAttrsSchema = z
  .object({
    'fuze.tenant.id': z.string().min(1),
    'fuze.principal.id': z.string().min(1),
    'fuze.lawful_basis': lawfulBasis.optional(),
    'fuze.annex_iii_domain': annexIIIDomain,
    'fuze.art22_decision': z.boolean(),
    'fuze.subject.ref': z.string().optional(),
    'fuze.retention.policy_id': z.string().min(1),
  })
  .strict()

export const EvidenceSpanSchema = z
  .object({
    span: z.string().min(1),
    role: spanRole,
    runId: z.string().min(1),
    stepId: z.string().min(1),
    startedAt: z.string().datetime({ offset: true }),
    endedAt: z.string().datetime({ offset: true }),
    common: SpanCommonAttrsSchema,
    attrs: z.record(z.unknown()),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    contentRef: z.string().optional(),
  })
  .strict()

export const ChainedRecordSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    prevHash: z.string().regex(/^[0-9a-f]{64}$/),
    hash: z.string().regex(/^[0-9a-f]{64}$/),
    payload: EvidenceSpanSchema,
  })
  .strict()

export const ResumeTokenSchema = z
  .object({
    runId: z.string().min(1),
    suspendedAtSequence: z.number().int().nonnegative(),
    chainHeadAtSuspend: z.string().regex(/^[0-9a-f]{64}$/),
    nonce: z.string().min(1),
    signature: z.string().min(1),
    publicKeyId: z.string().min(1),
  })
  .strict()

export const SuspendedRunSchema = z
  .object({
    runId: z.string().min(1),
    suspendedAtSpanId: z.string().min(1),
    suspendedAtSequence: z.number().int().nonnegative(),
    chainHeadAtSuspend: z.string().regex(/^[0-9a-f]{64}$/),
    toolName: z.string().min(1),
    toolArgs: z.record(z.unknown()),
    reason: z.string(),
    resumeToken: ResumeTokenSchema,
    definitionFingerprint: z.string().min(1),
  })
  .strict()

export const OversightDecisionSchema = z
  .object({
    action: approvalAction,
    rationale: z.string(),
    overseerId: z.string().min(1),
    trainingId: z.string().optional(),
    overrideArgs: z.record(z.unknown()).optional(),
  })
  .strict()

export const PostSpansRequestSchema = z
  .object({
    spans: z.array(ChainedRecordSchema).min(1),
  })
  .strict()

export const PostSpansResponseSchema = z
  .object({
    accepted: z.number().int().nonnegative(),
  })
  .strict()

export const PostSuspendedRunRequestSchema = z
  .object({
    suspendedRun: SuspendedRunSchema,
    subjectHmac: z.string().optional(),
  })
  .strict()

export const PostSuspendedRunResponseSchema = z
  .object({
    runId: z.string(),
    status: z.literal('pending'),
  })
  .strict()

export const ListSuspendedRunsQuerySchema = z
  .object({
    status: z.enum(['pending', 'decided']).optional(),
    tenant: z.string().optional(),
    limit: z.coerce.number().int().positive().max(500).optional(),
  })
  .strict()

export const SuspendedRunSummarySchema = z
  .object({
    runId: z.string(),
    toolName: z.string(),
    reason: z.string(),
    suspendedAtSequence: z.number().int().nonnegative(),
    status: z.enum(['pending', 'decided']),
    decidedAt: z.string().datetime({ offset: true }).optional(),
    subjectHmac: z.string().optional(),
  })
  .strict()

export const ListSuspendedRunsResponseSchema = z
  .object({
    runs: z.array(SuspendedRunSummarySchema),
  })
  .strict()

export const GetSuspendedRunResponseSchema = z
  .object({
    suspendedRun: SuspendedRunSchema,
    chain: z.array(ChainedRecordSchema),
    decision: OversightDecisionSchema.optional(),
  })
  .strict()

export const PostDecisionRequestSchema = z
  .object({
    decision: OversightDecisionSchema,
  })
  .strict()

export const PostDecisionResponseSchema = z
  .object({
    runId: z.string(),
    recordedAt: z.string().datetime({ offset: true }),
  })
  .strict()

export const GetDecisionQuerySchema = z
  .object({
    wait: z.coerce.number().int().min(0).max(60).optional(),
  })
  .strict()

export const GetDecisionResponseSchema = z
  .object({
    runId: z.string(),
    decision: OversightDecisionSchema.optional(),
    pending: z.boolean(),
  })
  .strict()

export const SubjectSpansQuerySchema = z
  .object({
    since: z.string().datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().positive().max(1000).optional(),
  })
  .strict()

export const SubjectSpansResponseSchema = z
  .object({
    spans: z.array(ChainedRecordSchema),
  })
  .strict()

export const VerifyRunResponseSchema = z
  .object({
    runId: z.string(),
    chainValid: z.boolean(),
    anchor: z
      .object({
        runRoot: z.string().regex(/^[0-9a-f]{64}$/),
        logId: z.string(),
        logIndex: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    anchorVerified: z.boolean(),
  })
  .strict()

export const HealthResponseSchema = z
  .object({
    status: z.literal('ok'),
    version: z.string(),
  })
  .strict()

export const ErrorResponseSchema = z
  .object({
    error: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  })
  .strict()

export type EvidenceSpanWire = z.infer<typeof EvidenceSpanSchema>
export type ChainedRecordWire = z.infer<typeof ChainedRecordSchema>
export type SuspendedRunWire = z.infer<typeof SuspendedRunSchema>
export type OversightDecisionWire = z.infer<typeof OversightDecisionSchema>
export type PostSpansRequest = z.infer<typeof PostSpansRequestSchema>
export type PostSpansResponse = z.infer<typeof PostSpansResponseSchema>
export type PostSuspendedRunRequest = z.infer<typeof PostSuspendedRunRequestSchema>
export type PostSuspendedRunResponse = z.infer<typeof PostSuspendedRunResponseSchema>
export type ListSuspendedRunsQuery = z.infer<typeof ListSuspendedRunsQuerySchema>
export type ListSuspendedRunsResponse = z.infer<typeof ListSuspendedRunsResponseSchema>
export type SuspendedRunSummary = z.infer<typeof SuspendedRunSummarySchema>
export type GetSuspendedRunResponse = z.infer<typeof GetSuspendedRunResponseSchema>
export type PostDecisionRequest = z.infer<typeof PostDecisionRequestSchema>
export type PostDecisionResponse = z.infer<typeof PostDecisionResponseSchema>
export type GetDecisionQuery = z.infer<typeof GetDecisionQuerySchema>
export type GetDecisionResponse = z.infer<typeof GetDecisionResponseSchema>
export type SubjectSpansQuery = z.infer<typeof SubjectSpansQuerySchema>
export type SubjectSpansResponse = z.infer<typeof SubjectSpansResponseSchema>
export type VerifyRunResponse = z.infer<typeof VerifyRunResponseSchema>
export type HealthResponse = z.infer<typeof HealthResponseSchema>
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>
