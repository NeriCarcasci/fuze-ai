import { createHash } from 'node:crypto'
import type { TenantId, PrincipalId, RunId, StepId } from '../types/brand.js'
import type { GdprLawfulBasis, AnnexIIIDomain, RetentionPolicy, SubjectRef } from '../types/compliance.js'
import { redact } from './redact.js'
import { canonicalize } from './canonical.js'
import { HashChain, type ChainedRecord } from './hash-chain.js'

export type SpanRole = 'agent' | 'model' | 'tool' | 'guardrail' | 'policy'

export const CURRENT_SPAN_SCHEMA_VERSION = 1 as const

export interface SpanCommonAttrs {
  readonly 'fuze.tenant.id': TenantId
  readonly 'fuze.principal.id': PrincipalId
  readonly 'fuze.lawful_basis'?: GdprLawfulBasis
  readonly 'fuze.annex_iii_domain': AnnexIIIDomain
  readonly 'fuze.art22_decision': boolean
  readonly 'fuze.subject.ref'?: string
  readonly 'fuze.retention.policy_id': string
}

export interface EvidenceSpan {
  readonly span: string
  readonly role: SpanRole
  readonly runId: RunId
  readonly stepId: StepId
  readonly startedAt: string
  readonly endedAt: string
  readonly common: SpanCommonAttrs
  readonly attrs: Readonly<Record<string, unknown>>
  readonly contentHash?: string
  readonly contentRef?: string
  readonly spanSchemaVersion?: number
}

export interface EvidenceEmitterDeps {
  readonly tenant: TenantId
  readonly principal: PrincipalId
  readonly runId: RunId
  readonly subjectRef?: SubjectRef
  readonly lawfulBasis: GdprLawfulBasis
  readonly annexIIIDomain: AnnexIIIDomain
  readonly producesArt22Decision: boolean
  readonly retention: RetentionPolicy
  readonly captureFullContent: boolean
  readonly sink: (record: ChainedRecord<EvidenceSpan>) => void | Promise<void>
  readonly resumeFrom?: { readonly chainHead: string; readonly nextSequence: number }
}

export class EvidenceEmitter {
  private readonly chain = new HashChain<EvidenceSpan>()
  private readonly buffered: ChainedRecord<EvidenceSpan>[] = []

  constructor(private readonly deps: EvidenceEmitterDeps) {
    if (deps.resumeFrom) {
      this.chain.resume(deps.resumeFrom.chainHead, deps.resumeFrom.nextSequence)
    }
  }

  private buildCommon(): SpanCommonAttrs {
    const base: Omit<SpanCommonAttrs, 'fuze.lawful_basis' | 'fuze.subject.ref'> = {
      'fuze.tenant.id': this.deps.tenant,
      'fuze.principal.id': this.deps.principal,
      'fuze.annex_iii_domain': this.deps.annexIIIDomain,
      'fuze.art22_decision': this.deps.producesArt22Decision,
      'fuze.retention.policy_id': this.deps.retention.id,
    }
    return {
      ...base,
      'fuze.lawful_basis': this.deps.lawfulBasis,
      ...(this.deps.subjectRef ? { 'fuze.subject.ref': this.deps.subjectRef.hmac } : {}),
    }
  }

  emit(input: {
    readonly span: string
    readonly role: SpanRole
    readonly stepId: StepId
    readonly startedAt: string
    readonly endedAt: string
    readonly attrs: Readonly<Record<string, unknown>>
    readonly content?: unknown
  }): ChainedRecord<EvidenceSpan> {
    const redactedAttrs = redact(input.attrs) as Record<string, unknown>

    let contentHash: string | undefined
    let contentRef: string | undefined
    if (input.content !== undefined) {
      const redactedContent = redact(input.content)
      const canonical = canonicalize(redactedContent)
      contentHash = createHash('sha256').update(canonical).digest('hex')
      if (this.deps.captureFullContent) {
        contentRef = `inline:${canonical}`
      }
    }

    const span: EvidenceSpan = {
      span: input.span,
      role: input.role,
      runId: this.deps.runId,
      stepId: input.stepId,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      common: this.buildCommon(),
      attrs: redactedAttrs,
      ...(contentHash ? { contentHash } : {}),
      ...(contentRef ? { contentRef } : {}),
    }

    const record = this.chain.append(span)
    this.buffered.push(record)
    void Promise.resolve(this.deps.sink(record)).catch(() => undefined)
    return record
  }

  head(): string {
    return this.chain.head()
  }

  records(): readonly ChainedRecord<EvidenceSpan>[] {
    return this.buffered.slice()
  }
}
