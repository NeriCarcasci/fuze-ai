import { describe, expect, it } from 'vitest'
import { PlanState, PlanStateError } from '../src/plan/plan-state.js'
import { makeRunId } from '../src/types/brand.js'

const RUN = makeRunId('run_test_plan')

const newPlan = () =>
  new PlanState({
    runId: RUN,
    minSteps: 2,
    clock: () => '2026-05-07T12:00:00.000Z',
    idMinter: (ord, ver, content) => `step_${ver}_${ord}_${content.slice(0, 4)}`,
  })

describe('PlanState', () => {
  it('commits an initial plan with stable IDs', () => {
    const plan = newPlan()
    const { event, version } = plan.commit({
      steps: [
        { content: 'Search policies', activeForm: 'Searching policies' },
        { content: 'Synthesize summary', activeForm: 'Synthesizing summary' },
      ],
    })
    expect(event.kind).toBe('plan_committed')
    expect(event.version).toBe(1)
    expect(version.steps).toHaveLength(2)
    expect(version.planHash).toMatch(/^[a-f0-9]{64}$/)
    expect(version.steps[0]!.status).toBe('pending')
  })

  it('refuses double commit', () => {
    const plan = newPlan()
    plan.commit({
      steps: [
        { content: 'a', activeForm: 'doing a' },
        { content: 'b', activeForm: 'doing b' },
      ],
    })
    expect(() =>
      plan.commit({ steps: [{ content: 'c', activeForm: 'doing c' }, { content: 'd', activeForm: 'doing d' }] }),
    ).toThrow(PlanStateError)
  })

  it('enforces minimum step count', () => {
    const plan = newPlan()
    expect(() => plan.commit({ steps: [{ content: 'only', activeForm: 'doing only' }] })).toThrow(
      /at least 2/,
    )
  })

  it('auto-captures evidence rows emitted while a step is in_progress', () => {
    const plan = newPlan()
    const { version } = plan.commit({
      steps: [
        { content: 'a', activeForm: 'doing a' },
        { content: 'b', activeForm: 'doing b' },
      ],
    })
    const a = version.steps[0]!.stepId
    plan.updateStep({ stepId: a, status: 'in_progress' })
    plan.recordEvidence('row-1')
    plan.recordEvidence('row-2')
    const { event } = plan.updateStep({ stepId: a, status: 'done' })
    expect(event.evidenceRefs).toEqual(['row-1', 'row-2'])
    expect(event.linkageSource).toBe('auto')
  })

  it('honors explicit evidenceRefs as additive on top of auto-capture', () => {
    const plan = newPlan()
    const { version } = plan.commit({
      steps: [
        { content: 'a', activeForm: 'doing a' },
        { content: 'b', activeForm: 'doing b' },
      ],
    })
    const a = version.steps[0]!.stepId
    plan.updateStep({ stepId: a, status: 'in_progress' })
    plan.recordEvidence('row-auto')
    const { event } = plan.updateStep({
      stepId: a,
      status: 'done',
      evidenceRefs: ['row-explicit'],
    })
    expect(event.evidenceRefs).toEqual(['row-auto', 'row-explicit'])
    expect(event.linkageSource).toBe('explicit')
  })

  it('honors unlink_refs as a correction', () => {
    const plan = newPlan()
    const { version } = plan.commit({
      steps: [
        { content: 'a', activeForm: 'doing a' },
        { content: 'b', activeForm: 'doing b' },
      ],
    })
    const a = version.steps[0]!.stepId
    plan.updateStep({ stepId: a, status: 'in_progress' })
    plan.recordEvidence('row-mistake')
    plan.recordEvidence('row-keep')
    const { event } = plan.updateStep({
      stepId: a,
      status: 'done',
      unlinkRefs: ['row-mistake'],
    })
    expect(event.evidenceRefs).toEqual(['row-keep'])
    expect(event.linkageSource).toBe('corrected')
  })

  it('refuses to revert a done step', () => {
    const plan = newPlan()
    const { version } = plan.commit({
      steps: [
        { content: 'a', activeForm: 'doing a' },
        { content: 'b', activeForm: 'doing b' },
      ],
    })
    const a = version.steps[0]!.stepId
    plan.updateStep({ stepId: a, status: 'in_progress' })
    plan.updateStep({ stepId: a, status: 'done' })
    expect(() => plan.updateStep({ stepId: a, status: 'in_progress' })).toThrow(
      /append-only/,
    )
  })

  it('revises with stable IDs and derived_from edges', () => {
    const plan = newPlan()
    const { version: v1 } = plan.commit({
      steps: [
        { content: 'big-step', activeForm: 'doing big' },
        { content: 'tail', activeForm: 'doing tail' },
      ],
    })
    const big = v1.steps[0]!.stepId
    plan.updateStep({ stepId: big, status: 'in_progress' })
    plan.updateStep({ stepId: big, status: 'done' })

    const { event, version: v2 } = plan.revise({
      addSteps: [
        {
          ordinal: 2,
          content: 'big-part-a',
          activeForm: 'doing part a',
          derivedFrom: [big],
        },
        {
          ordinal: 3,
          content: 'big-part-b',
          activeForm: 'doing part b',
          derivedFrom: [big],
        },
      ],
      rationale: 'split big-step into two parts because policy requires separate evidence',
    })
    expect(event.kind).toBe('plan_revised')
    expect(event.added).toHaveLength(2)
    expect(v2.version).toBe(2)
    // Original step is preserved with done status
    expect(plan.step(big)?.status).toBe('done')
    // New steps reference the original via derived_from
    const partA = v2.steps.find((s) => s.content === 'big-part-a')!
    expect(partA.derivedFrom).toEqual([big])
  })

  it('marks removed steps as superseded, evidence stays linked', () => {
    const plan = newPlan()
    const { version: v1 } = plan.commit({
      steps: [
        { content: 'a', activeForm: 'doing a' },
        { content: 'b', activeForm: 'doing b' },
        { content: 'c', activeForm: 'doing c' },
      ],
    })
    const b = v1.steps[1]!.stepId
    plan.updateStep({ stepId: b, status: 'in_progress' })
    plan.recordEvidence('row-on-b')
    plan.updateStep({ stepId: b, status: 'done' })

    plan.revise({ removeSteps: [b], rationale: 'no longer needed' })
    const after = plan.step(b)!
    expect(after.status).toBe('superseded')
    expect(after.evidenceRefs).toContain('row-on-b')
  })

  it('refuses revise with empty rationale', () => {
    const plan = newPlan()
    plan.commit({
      steps: [
        { content: 'a', activeForm: 'doing a' },
        { content: 'b', activeForm: 'doing b' },
      ],
    })
    expect(() => plan.revise({ rationale: '   ' })).toThrow(/rationale/)
  })

  it('chains plan hashes across revisions', () => {
    const plan = newPlan()
    const { version: v1 } = plan.commit({
      steps: [
        { content: 'a', activeForm: 'doing a' },
        { content: 'b', activeForm: 'doing b' },
      ],
    })
    const { version: v2 } = plan.revise({
      addSteps: [{ ordinal: 2, content: 'c', activeForm: 'doing c' }],
      rationale: 'add c',
    })
    expect(v2.prevPlanHash).toBe(v1.planHash)
    expect(v2.planHash).not.toBe(v1.planHash)
  })
})
