/**
 * PlanState — in-memory plan with hash-chained version history.
 *
 * Implements the design from research stream A:
 *   - Stable step IDs that never get reassigned across revisions.
 *   - Append-only revisions; completed steps stay completed.
 *   - Splits create new steps with derivedFrom edges.
 *   - Removed steps get status='superseded' (evidence stays linked).
 *   - Auto-capture is the default: rows emitted while a step is in_progress
 *     are linked to that step. Explicit evidenceRefs on update_plan_step
 *     adds; unlink_refs corrects auto-captured mistakes.
 *   - Per-step lifecycle timestamps (Mastra-style).
 *   - Each version's planHash chains to the prior via prevPlanHash.
 *
 * Wiring to EvidenceEmitter is the responsibility of the loop integration
 * (deferred to a follow-up). This module emits PlanEvent objects synchronously;
 * the loop sinks them.
 */

import { createHash } from 'node:crypto'
import { canonicalize } from '../evidence/canonical.js'
import type { RunId } from '../types/brand.js'
import type {
  PlanCommitInput,
  PlanCommittedEvent,
  PlanEvent,
  PlanReviseInput,
  PlanRevisedEvent,
  PlanStep,
  PlanStepStatus,
  PlanStepUpdateInput,
  PlanStepUpdatedEvent,
  PlanVersion,
  LinkageSource,
} from '../types/plan.js'

const ZERO_PLAN_HASH = '0'.repeat(64)

const sha256 = (canonical: string): string =>
  createHash('sha256').update(canonical).digest('hex')

const hashPlan = (steps: readonly PlanStep[], version: number, prev: string): string =>
  sha256(canonicalize({ version, prev, steps }))

const hashUpdate = (input: {
  stepId: string
  from: PlanStepStatus
  to: PlanStepStatus
  evidenceRefs: readonly string[]
  prev: string
}): string => sha256(canonicalize(input))

const mintStepId = (ordinal: number, version: number, content: string): string => {
  const seed = `${ordinal}|${version}|${content}|${Date.now().toString(36)}|${Math.random().toString(36).slice(2)}`
  return `step_${sha256(seed).slice(0, 12)}`
}

export interface PlanStateOptions {
  readonly runId: RunId
  readonly minSteps?: number
  readonly maxSteps?: number
  readonly clock?: () => string
  readonly idMinter?: (ordinal: number, version: number, content: string) => string
}

export interface PlanStateResult<E extends PlanEvent> {
  readonly event: E
  readonly version: PlanVersion
}

export class PlanStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlanStateError'
  }
}

export class PlanState {
  private readonly runId: RunId
  private readonly minSteps: number
  private readonly maxSteps: number
  private readonly clock: () => string
  private readonly mintId: (ordinal: number, version: number, content: string) => string

  private versions: PlanVersion[] = []
  private stepsById = new Map<string, PlanStep>()
  private currentStepId: string | null = null
  private autoCaptureBuffer = new Map<string, Set<string>>()

  constructor(opts: PlanStateOptions) {
    this.runId = opts.runId
    this.minSteps = opts.minSteps ?? 2
    this.maxSteps = opts.maxSteps ?? 10
    this.clock = opts.clock ?? (() => new Date().toISOString())
    this.mintId = opts.idMinter ?? mintStepId
  }

  hasPlan(): boolean {
    return this.versions.length > 0
  }

  currentVersion(): PlanVersion | null {
    return this.versions[this.versions.length - 1] ?? null
  }

  allVersions(): readonly PlanVersion[] {
    return this.versions.slice()
  }

  step(stepId: string): PlanStep | null {
    return this.stepsById.get(stepId) ?? null
  }

  activeStepId(): string | null {
    return this.currentStepId
  }

  commit(input: PlanCommitInput): PlanStateResult<PlanCommittedEvent> {
    if (this.versions.length > 0) {
      throw new PlanStateError('Plan already committed; use revise() to change it.')
    }
    if (input.steps.length < this.minSteps) {
      throw new PlanStateError(
        `Plan must have at least ${this.minSteps} steps; got ${input.steps.length}.`,
      )
    }
    if (input.steps.length > this.maxSteps) {
      throw new PlanStateError(
        `Plan cannot exceed ${this.maxSteps} steps; got ${input.steps.length}.`,
      )
    }

    const createdAt = this.clock()
    const steps: PlanStep[] = input.steps.map((s, i) => {
      const stepId = this.mintId(i, 1, s.content)
      const step: PlanStep = {
        stepId,
        ordinal: i,
        content: s.content,
        activeForm: s.activeForm,
        status: 'pending',
        lifecycle: { createdAt },
        ...(s.parentStepId !== undefined ? { parentStepId: s.parentStepId } : {}),
        evidenceRefs: [],
      }
      this.stepsById.set(stepId, step)
      this.autoCaptureBuffer.set(stepId, new Set<string>())
      return step
    })

    const planHash = hashPlan(steps, 1, ZERO_PLAN_HASH)
    const version: PlanVersion = {
      version: 1,
      createdAt,
      steps,
      planHash,
    }
    this.versions.push(version)

    const event: PlanCommittedEvent = {
      kind: 'plan_committed',
      version: 1,
      planHash,
      runId: this.runId,
      steps,
    }
    return { event, version }
  }

  /**
   * Auto-capture hook: the loop calls this on every evidence row emitted.
   * Rows emitted while a step is in_progress get linked to that step
   * with linkageSource='auto'.
   *
   * Returns the linkage source assigned ('auto') or null if no capture happened.
   */
  recordEvidence(evidenceRef: string): { stepId: string; source: LinkageSource } | null {
    if (!this.currentStepId) return null
    const buffer = this.autoCaptureBuffer.get(this.currentStepId)
    if (!buffer) return null
    buffer.add(evidenceRef)
    return { stepId: this.currentStepId, source: 'auto' }
  }

  updateStep(input: PlanStepUpdateInput): PlanStateResult<PlanStepUpdatedEvent> {
    const current = this.currentVersion()
    if (!current) {
      throw new PlanStateError('No plan committed; cannot update step.')
    }
    const step = this.stepsById.get(input.stepId)
    if (!step) {
      throw new PlanStateError(`Unknown step_id: ${input.stepId}`)
    }
    if (step.status === 'done' && input.status !== 'done') {
      throw new PlanStateError(
        `Step ${input.stepId} is already done; status is append-only — cannot revert.`,
      )
    }
    if (step.status === 'superseded') {
      throw new PlanStateError(
        `Step ${input.stepId} is superseded; updates not permitted.`,
      )
    }

    const from = step.status
    const to = input.status
    const now = this.clock()

    const explicit = input.evidenceRefs ?? []
    const auto = Array.from(this.autoCaptureBuffer.get(input.stepId) ?? new Set<string>())
    const unlink = new Set(input.unlinkRefs ?? [])
    const merged: string[] = []
    const seen = new Set<string>()
    for (const ref of [...auto, ...explicit, ...step.evidenceRefs]) {
      if (unlink.has(ref)) continue
      if (seen.has(ref)) continue
      seen.add(ref)
      merged.push(ref)
    }

    const linkageSource: LinkageSource =
      explicit.length > 0 || unlink.size > 0
        ? unlink.size > 0
          ? 'corrected'
          : 'explicit'
        : 'auto'

    const lifecycle = {
      ...step.lifecycle,
      ...(to === 'in_progress' && !step.lifecycle.startedAt ? { startedAt: now } : {}),
      ...(to === 'blocked' ? { suspendedAt: now } : {}),
      ...(from === 'blocked' && to === 'in_progress' ? { resumedAt: now } : {}),
      ...(['done', 'failed', 'skipped'].includes(to) ? { endedAt: now } : {}),
    }

    const updated: PlanStep = {
      ...step,
      status: to,
      lifecycle,
      evidenceRefs: merged,
      ...(input.note !== undefined ? { note: input.note } : {}),
    }
    this.stepsById.set(input.stepId, updated)

    if (to === 'in_progress') {
      this.currentStepId = input.stepId
    } else if (this.currentStepId === input.stepId) {
      this.currentStepId = null
    }

    const newSteps = current.steps.map((s) =>
      s.stepId === input.stepId ? updated : s,
    )
    const newPlanHash = hashPlan(newSteps, current.version, current.planHash)
    const newVersion: PlanVersion = {
      ...current,
      steps: newSteps,
      planHash: newPlanHash,
      prevPlanHash: current.planHash,
    }
    this.versions[this.versions.length - 1] = newVersion

    const deltaHash = hashUpdate({
      stepId: input.stepId,
      from,
      to,
      evidenceRefs: merged,
      prev: current.planHash,
    })

    const event: PlanStepUpdatedEvent = {
      kind: 'plan_step_updated',
      version: current.version,
      stepId: input.stepId,
      from,
      to,
      evidenceRefs: merged,
      linkageSource,
      ...(input.note !== undefined ? { note: input.note } : {}),
      deltaHash,
      prevHash: current.planHash,
    }

    return { event, version: newVersion }
  }

  revise(input: PlanReviseInput): PlanStateResult<PlanRevisedEvent> {
    const current = this.currentVersion()
    if (!current) {
      throw new PlanStateError('No plan committed; nothing to revise.')
    }
    if (!input.rationale || input.rationale.trim().length === 0) {
      throw new PlanStateError('revise_plan requires a non-empty rationale.')
    }

    const newVersion = current.version + 1
    const createdAt = this.clock()
    const removed = new Set(input.removeSteps ?? [])
    const reorderMap = new Map((input.reorder ?? []).map((r) => [r.stepId, r.ordinal]))
    const addedIds: string[] = []
    const reorderedIds: string[] = []

    const carriedSteps: PlanStep[] = current.steps.map((s) => {
      if (removed.has(s.stepId)) {
        const superseded: PlanStep = {
          ...s,
          status: 'superseded',
          lifecycle: { ...s.lifecycle, endedAt: s.lifecycle.endedAt ?? createdAt },
        }
        this.stepsById.set(s.stepId, superseded)
        return superseded
      }
      if (reorderMap.has(s.stepId)) {
        reorderedIds.push(s.stepId)
        const reordered: PlanStep = { ...s, ordinal: reorderMap.get(s.stepId)! }
        this.stepsById.set(s.stepId, reordered)
        return reordered
      }
      return s
    })

    const newSteps: PlanStep[] = (input.addSteps ?? []).map((a) => {
      const stepId = a.stepId ?? this.mintId(a.ordinal, newVersion, a.content)
      const step: PlanStep = {
        stepId,
        ordinal: a.ordinal,
        content: a.content,
        activeForm: a.activeForm,
        status: 'pending',
        lifecycle: { createdAt },
        ...(a.parentStepId !== undefined ? { parentStepId: a.parentStepId } : {}),
        ...(a.derivedFrom !== undefined ? { derivedFrom: a.derivedFrom } : {}),
        evidenceRefs: [],
      }
      this.stepsById.set(stepId, step)
      this.autoCaptureBuffer.set(stepId, new Set<string>())
      addedIds.push(stepId)
      return step
    })

    const allSteps = [...carriedSteps, ...newSteps].sort((a, b) => a.ordinal - b.ordinal)
    const planHash = hashPlan(allSteps, newVersion, current.planHash)

    const version: PlanVersion = {
      version: newVersion,
      createdAt,
      steps: allSteps,
      planHash,
      prevPlanHash: current.planHash,
      rationale: input.rationale,
    }
    this.versions.push(version)

    const event: PlanRevisedEvent = {
      kind: 'plan_revised',
      version: newVersion,
      planHash,
      prevHash: current.planHash,
      rationale: input.rationale,
      added: addedIds,
      removed: Array.from(removed),
      reordered: reorderedIds,
    }
    return { event, version }
  }
}
