import { describe, expect, it } from 'vitest'
import {
  ChainedRecordSchema,
  EvidenceSpanSchema,
  GetDecisionQuerySchema,
  GetSuspendedRunResponseSchema,
  HealthResponseSchema,
  ListSuspendedRunsQuerySchema,
  OversightDecisionSchema,
  PostDecisionRequestSchema,
  PostSpansRequestSchema,
  PostSuspendedRunRequestSchema,
  ResumeTokenSchema,
  SubjectSpansQuerySchema,
  SuspendedRunSchema,
  VerifyRunResponseSchema,
} from '../src/schemas.js'

const HASH64 = 'a'.repeat(64)

const validSpan = {
  span: 'tool.invoke',
  role: 'tool' as const,
  runId: 'run_1',
  stepId: 'step_1',
  startedAt: '2025-01-01T00:00:00.000Z',
  endedAt: '2025-01-01T00:00:01.000Z',
  common: {
    'fuze.tenant.id': 't1',
    'fuze.principal.id': 'p1',
    'fuze.lawful_basis': 'contract' as const,
    'fuze.annex_iii_domain': 'none' as const,
    'fuze.art22_decision': false,
    'fuze.retention.policy_id': 'fuze.default.v1',
  },
  attrs: { foo: 'bar' },
}

const validChained = {
  sequence: 0,
  prevHash: '0'.repeat(64),
  hash: HASH64,
  payload: validSpan,
}

const validResumeToken = {
  runId: 'run_1',
  suspendedAtSequence: 3,
  chainHeadAtSuspend: HASH64,
  nonce: 'nonce_1',
  signature: 'sig',
  publicKeyId: 'k1',
}

const validSuspendedRun = {
  runId: 'run_1',
  suspendedAtSpanId: 'step_3',
  suspendedAtSequence: 3,
  chainHeadAtSuspend: HASH64,
  toolName: 'tool.send',
  toolArgs: { to: 'a@b.c' },
  reason: 'requires-approval',
  resumeToken: validResumeToken,
  definitionFingerprint: 'fp',
}

describe('EvidenceSpanSchema', () => {
  it('accepts a valid span', () => {
    expect(EvidenceSpanSchema.parse(validSpan)).toBeDefined()
  })

  it('accepts a span without optional fields', () => {
    const { contentHash: _ch, contentRef: _cr, ...span } = {
      ...validSpan,
      contentHash: undefined,
      contentRef: undefined,
    }
    expect(EvidenceSpanSchema.parse(span)).toBeDefined()
  })

  it('rejects malformed timestamps', () => {
    expect(() =>
      EvidenceSpanSchema.parse({ ...validSpan, startedAt: 'yesterday' }),
    ).toThrow()
  })

  it('rejects unknown role', () => {
    expect(() => EvidenceSpanSchema.parse({ ...validSpan, role: 'wizard' })).toThrow()
  })
})

describe('ChainedRecordSchema', () => {
  it('accepts a valid chained record', () => {
    expect(ChainedRecordSchema.parse(validChained)).toBeDefined()
  })

  it('rejects bad hash length', () => {
    expect(() => ChainedRecordSchema.parse({ ...validChained, hash: 'short' })).toThrow()
  })
})

describe('ResumeTokenSchema and SuspendedRunSchema', () => {
  it('parses a valid resume token', () => {
    expect(ResumeTokenSchema.parse(validResumeToken)).toBeDefined()
  })

  it('parses a valid suspended run', () => {
    expect(SuspendedRunSchema.parse(validSuspendedRun)).toBeDefined()
  })

  it('rejects suspended run with non-hex chain head', () => {
    expect(() =>
      SuspendedRunSchema.parse({ ...validSuspendedRun, chainHeadAtSuspend: 'nope' }),
    ).toThrow()
  })
})

describe('OversightDecisionSchema', () => {
  it('parses minimal valid decision', () => {
    const d = OversightDecisionSchema.parse({
      action: 'approve',
      rationale: 'looks fine',
      overseerId: 'user_1',
    })
    expect(d.action).toBe('approve')
  })

  it('rejects unknown action', () => {
    expect(() =>
      OversightDecisionSchema.parse({
        action: 'maybe',
        rationale: '',
        overseerId: 'u',
      }),
    ).toThrow()
  })

  it('accepts overrideArgs and trainingId', () => {
    const d = OversightDecisionSchema.parse({
      action: 'override',
      rationale: 'fix args',
      overseerId: 'u',
      trainingId: 't1',
      overrideArgs: { to: 'safe@example.com' },
    })
    expect(d.trainingId).toBe('t1')
  })
})

describe('Request and response schemas', () => {
  it('PostSpansRequestSchema requires non-empty array', () => {
    expect(() => PostSpansRequestSchema.parse({ spans: [] })).toThrow()
    expect(PostSpansRequestSchema.parse({ spans: [validChained] })).toBeDefined()
  })

  it('PostSuspendedRunRequestSchema accepts optional subjectHmac', () => {
    expect(
      PostSuspendedRunRequestSchema.parse({ suspendedRun: validSuspendedRun }),
    ).toBeDefined()
    expect(
      PostSuspendedRunRequestSchema.parse({
        suspendedRun: validSuspendedRun,
        subjectHmac: 'h',
      }),
    ).toBeDefined()
  })

  it('PostDecisionRequestSchema validates inner decision', () => {
    expect(() =>
      PostDecisionRequestSchema.parse({
        decision: { action: 'nope', rationale: '', overseerId: 'u' },
      }),
    ).toThrow()
  })

  it('GetSuspendedRunResponseSchema includes chain', () => {
    const parsed = GetSuspendedRunResponseSchema.parse({
      suspendedRun: validSuspendedRun,
      chain: [validChained],
    })
    expect(parsed.chain).toHaveLength(1)
  })

  it('VerifyRunResponseSchema makes anchor optional', () => {
    expect(
      VerifyRunResponseSchema.parse({
        runId: 'run_1',
        chainValid: true,
        anchorVerified: false,
      }),
    ).toBeDefined()
  })

  it('HealthResponseSchema accepts ok', () => {
    expect(HealthResponseSchema.parse({ status: 'ok', version: '0.1.0' })).toBeDefined()
  })
})

describe('Query schemas', () => {
  it('ListSuspendedRunsQuerySchema coerces limit', () => {
    const q = ListSuspendedRunsQuerySchema.parse({ limit: '50' })
    expect(q.limit).toBe(50)
  })

  it('GetDecisionQuerySchema rejects negative wait', () => {
    expect(() => GetDecisionQuerySchema.parse({ wait: '-1' })).toThrow()
  })

  it('SubjectSpansQuerySchema accepts since', () => {
    const q = SubjectSpansQuerySchema.parse({ since: '2025-01-01T00:00:00Z' })
    expect(q.since).toBeDefined()
  })
})
