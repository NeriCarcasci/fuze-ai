import { z, type ZodTypeAny } from 'zod'
import { PATH_TEMPLATES } from './paths.js'
import {
  ChainedRecordSchema,
  ErrorResponseSchema,
  EvidenceSpanSchema,
  GetDecisionQuerySchema,
  GetDecisionResponseSchema,
  GetSuspendedRunResponseSchema,
  HealthResponseSchema,
  ListSuspendedRunsQuerySchema,
  ListSuspendedRunsResponseSchema,
  OversightDecisionSchema,
  PostDecisionRequestSchema,
  PostDecisionResponseSchema,
  PostSpansRequestSchema,
  PostSpansResponseSchema,
  PostSuspendedRunRequestSchema,
  PostSuspendedRunResponseSchema,
  ResumeTokenSchema,
  SpanCommonAttrsSchema,
  SubjectSpansQuerySchema,
  SubjectSpansResponseSchema,
  SuspendedRunSchema,
  SuspendedRunSummarySchema,
  VerifyRunResponseSchema,
} from './schemas.js'

type JsonSchema = Record<string, unknown>

const componentRefs = new Map<ZodTypeAny, string>()

const componentSchemas: Record<string, ZodTypeAny> = {
  EvidenceSpan: EvidenceSpanSchema,
  SpanCommonAttrs: SpanCommonAttrsSchema,
  ChainedRecord: ChainedRecordSchema,
  ResumeToken: ResumeTokenSchema,
  SuspendedRun: SuspendedRunSchema,
  OversightDecision: OversightDecisionSchema,
  SuspendedRunSummary: SuspendedRunSummarySchema,
  PostSpansRequest: PostSpansRequestSchema,
  PostSpansResponse: PostSpansResponseSchema,
  PostSuspendedRunRequest: PostSuspendedRunRequestSchema,
  PostSuspendedRunResponse: PostSuspendedRunResponseSchema,
  ListSuspendedRunsResponse: ListSuspendedRunsResponseSchema,
  GetSuspendedRunResponse: GetSuspendedRunResponseSchema,
  PostDecisionRequest: PostDecisionRequestSchema,
  PostDecisionResponse: PostDecisionResponseSchema,
  GetDecisionResponse: GetDecisionResponseSchema,
  SubjectSpansResponse: SubjectSpansResponseSchema,
  VerifyRunResponse: VerifyRunResponseSchema,
  HealthResponse: HealthResponseSchema,
  ErrorResponse: ErrorResponseSchema,
}

for (const [name, schema] of Object.entries(componentSchemas)) {
  componentRefs.set(schema, `#/components/schemas/${name}`)
}

const zodToJsonSchema = (schema: ZodTypeAny, useRefs = true): JsonSchema => {
  if (useRefs) {
    const ref = componentRefs.get(schema)
    if (ref) return { $ref: ref }
  }
  const def = schema._def as { typeName: string } & Record<string, unknown>

  switch (def.typeName) {
    case 'ZodString': {
      const out: JsonSchema = { type: 'string' }
      const checks = (def['checks'] as Array<{ kind: string; regex?: RegExp; offset?: boolean }>) ?? []
      for (const c of checks) {
        if (c.kind === 'datetime') out['format'] = 'date-time'
        if (c.kind === 'regex' && c.regex) out['pattern'] = c.regex.source
      }
      return out
    }
    case 'ZodNumber': {
      const out: JsonSchema = { type: 'number' }
      const checks = (def['checks'] as Array<{ kind: string; value?: number }>) ?? []
      for (const c of checks) {
        if (c.kind === 'int') out['type'] = 'integer'
        if (c.kind === 'min' && typeof c.value === 'number') out['minimum'] = c.value
        if (c.kind === 'max' && typeof c.value === 'number') out['maximum'] = c.value
      }
      return out
    }
    case 'ZodBoolean':
      return { type: 'boolean' }
    case 'ZodLiteral':
      return { const: def['value'] }
    case 'ZodEnum':
      return { type: 'string', enum: def['values'] as readonly string[] }
    case 'ZodArray':
      return { type: 'array', items: zodToJsonSchema(def['type'] as ZodTypeAny) }
    case 'ZodObject': {
      const shape = (def['shape'] as () => Record<string, ZodTypeAny>)()
      const properties: Record<string, JsonSchema> = {}
      const required: string[] = []
      for (const [key, value] of Object.entries(shape)) {
        const inner = unwrapOptional(value)
        properties[key] = zodToJsonSchema(inner.schema)
        if (!inner.optional) required.push(key)
      }
      const out: JsonSchema = { type: 'object', properties, additionalProperties: false }
      if (required.length > 0) out['required'] = required
      return out
    }
    case 'ZodRecord':
      return {
        type: 'object',
        additionalProperties: zodToJsonSchema(def['valueType'] as ZodTypeAny),
      }
    case 'ZodOptional':
      return zodToJsonSchema(def['innerType'] as ZodTypeAny)
    case 'ZodEffects':
      return zodToJsonSchema(def['schema'] as ZodTypeAny)
    case 'ZodUnknown':
    case 'ZodAny':
      return {}
    default:
      return {}
  }
}

const unwrapOptional = (
  schema: ZodTypeAny,
): { readonly optional: boolean; readonly schema: ZodTypeAny } => {
  let s: ZodTypeAny = schema
  let optional = false
  while (s instanceof z.ZodOptional || s instanceof z.ZodDefault) {
    optional = true
    s = (s._def as { innerType: ZodTypeAny }).innerType
  }
  return { optional, schema: s }
}

const buildComponents = (): JsonSchema => {
  const schemas: Record<string, JsonSchema> = {}
  for (const [name, schema] of Object.entries(componentSchemas)) {
    schemas[name] = zodToJsonSchema(schema, false)
  }
  return { schemas }
}

const json = (schema: ZodTypeAny): JsonSchema => zodToJsonSchema(schema)

const queryParameters = (schema: ZodTypeAny): JsonSchema[] => {
  const def = schema._def as { typeName: string; shape: () => Record<string, ZodTypeAny> }
  if (def.typeName !== 'ZodObject') return []
  const shape = def.shape()
  const params: JsonSchema[] = []
  for (const [name, raw] of Object.entries(shape)) {
    const { optional, schema: inner } = unwrapOptional(raw)
    params.push({
      name,
      in: 'query',
      required: !optional,
      schema: zodToJsonSchema(inner, false),
    })
  }
  return params
}

const pathParam = (name: string): JsonSchema => ({
  name,
  in: 'path',
  required: true,
  schema: { type: 'string' },
})

const jsonResponse = (schema: ZodTypeAny, description: string): JsonSchema => ({
  description,
  content: { 'application/json': { schema: json(schema) } },
})

const errorResponse = (description: string): JsonSchema =>
  jsonResponse(ErrorResponseSchema, description)

const requestBody = (schema: ZodTypeAny): JsonSchema => ({
  required: true,
  content: { 'application/json': { schema: json(schema) } },
})

export const buildOpenApi = (info?: { title?: string; version?: string }): JsonSchema => {
  const paths: Record<string, JsonSchema> = {
    [PATH_TEMPLATES.spans]: {
      post: {
        operationId: 'postSpans',
        summary: 'Ingest evidence spans',
        requestBody: requestBody(PostSpansRequestSchema),
        responses: {
          '200': jsonResponse(PostSpansResponseSchema, 'Spans accepted'),
          '400': errorResponse('Invalid spans'),
          '401': errorResponse('Missing credentials'),
        },
      },
    },
    [PATH_TEMPLATES.suspendedRuns]: {
      post: {
        operationId: 'postSuspendedRun',
        summary: 'Ingest a suspended run',
        requestBody: requestBody(PostSuspendedRunRequestSchema),
        responses: {
          '201': jsonResponse(PostSuspendedRunResponseSchema, 'Suspended run accepted'),
          '400': errorResponse('Invalid suspended run'),
        },
      },
      get: {
        operationId: 'listSuspendedRuns',
        summary: 'List suspended runs',
        parameters: queryParameters(ListSuspendedRunsQuerySchema),
        responses: {
          '200': jsonResponse(ListSuspendedRunsResponseSchema, 'Suspended runs'),
        },
      },
    },
    [PATH_TEMPLATES.suspendedRun]: {
      get: {
        operationId: 'getSuspendedRun',
        summary: 'Get a suspended run with its evidence chain',
        parameters: [pathParam('runId')],
        responses: {
          '200': jsonResponse(GetSuspendedRunResponseSchema, 'Suspended run'),
          '404': errorResponse('Not found'),
        },
      },
    },
    [PATH_TEMPLATES.suspendedRunDecisions]: {
      post: {
        operationId: 'postDecision',
        summary: 'Submit an oversight decision',
        parameters: [pathParam('runId')],
        requestBody: requestBody(PostDecisionRequestSchema),
        responses: {
          '200': jsonResponse(PostDecisionResponseSchema, 'Decision recorded'),
          '404': errorResponse('Not found'),
        },
      },
    },
    [PATH_TEMPLATES.runDecisions]: {
      get: {
        operationId: 'getDecision',
        summary: 'Long-poll for an oversight decision',
        parameters: [pathParam('runId'), ...queryParameters(GetDecisionQuerySchema)],
        responses: {
          '200': jsonResponse(GetDecisionResponseSchema, 'Decision (or pending)'),
        },
      },
    },
    [PATH_TEMPLATES.subjectSpans]: {
      get: {
        operationId: 'getSubjectSpans',
        summary: 'Query evidence by data subject',
        parameters: [pathParam('hmac'), ...queryParameters(SubjectSpansQuerySchema)],
        responses: {
          '200': jsonResponse(SubjectSpansResponseSchema, 'Matching spans'),
        },
      },
    },
    [PATH_TEMPLATES.runVerify]: {
      get: {
        operationId: 'verifyRun',
        summary: 'Verify a run chain and transparency anchor',
        parameters: [pathParam('runId')],
        responses: {
          '200': jsonResponse(VerifyRunResponseSchema, 'Verification result'),
          '404': errorResponse('Not found'),
        },
      },
    },
    [PATH_TEMPLATES.health]: {
      get: {
        operationId: 'getHealth',
        summary: 'Liveness probe',
        responses: {
          '200': jsonResponse(HealthResponseSchema, 'Server is healthy'),
        },
      },
    },
  }

  return {
    openapi: '3.1.0',
    info: {
      title: info?.title ?? 'Fuze Agent API',
      version: info?.version ?? '0.1.0',
      description: 'EU-compliant evidence ingest, HITL oversight, and audit verification.',
    },
    components: buildComponents(),
    paths,
  }
}
