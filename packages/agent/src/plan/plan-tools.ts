/**
 * buildPlanTools — synthesize the three plan tools (commit_plan,
 * update_plan_step, revise_plan) bound to a per-run PlanState instance.
 *
 * Each tool is a `PublicTool`: plans contain only the agent's own structural
 * intent, no sensitive data. Tool-result guardrails apply normally.
 *
 * The runtime injects these into the agent's tool list when planning is
 * configured. They appear to the model under their declared names and are
 * tracked in the evidence chain like any other tool call — except the
 * tool body mutates the PlanState rather than calling out.
 */

import { z } from 'zod'
import type { PublicTool } from '../types/tool.js'
import { Ok, Err } from '../types/result.js'
import type { PlanState } from './plan-state.js'
import { PlanStateError } from './plan-state.js'
import { DEFAULT_RETENTION } from '../types/compliance.js'

const PLAN_TOOL_BOUNDARY = {
  trustedCallers: ['agent-loop'] as const,
  observesSecrets: false,
  egressDomains: 'none' as const,
  readsFilesystem: false,
  writesFilesystem: false,
}

const commitPlanInput = z.object({
  steps: z
    .array(
      z.object({
        content: z.string().min(3),
        active_form: z.string().min(3),
        parent_step_id: z.string().optional(),
      }),
    )
    .min(2)
    .max(20),
})

const commitPlanOutput = z.object({
  plan_hash: z.string(),
  steps_committed: z.number(),
  step_ids: z.array(z.string()),
})

const updatePlanStepInput = z.object({
  step_id: z.string(),
  status: z.enum(['pending', 'in_progress', 'done', 'blocked', 'failed', 'skipped']),
  evidence_refs: z.array(z.string()).optional(),
  unlink_refs: z.array(z.string()).optional(),
  note: z.string().optional(),
})

const updatePlanStepOutput = z.object({
  applied: z.boolean(),
  delta_hash: z.string(),
  evidence_refs: z.array(z.string()),
  linkage_source: z.enum(['auto', 'explicit', 'corrected']),
})

const revisePlanInput = z.object({
  add_steps: z
    .array(
      z.object({
        ordinal: z.number().int().min(0),
        content: z.string().min(3),
        active_form: z.string().min(3),
        parent_step_id: z.string().optional(),
        derived_from: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  remove_steps: z.array(z.string()).optional(),
  reorder: z.array(z.object({ step_id: z.string(), ordinal: z.number().int().min(0) })).optional(),
  rationale: z.string().min(10),
})

const revisePlanOutput = z.object({
  version: z.number(),
  plan_hash: z.string(),
  added: z.array(z.string()),
  removed: z.array(z.string()),
  reordered: z.array(z.string()),
})

export interface PlanTools {
  readonly commitPlan: PublicTool<z.infer<typeof commitPlanInput>, z.infer<typeof commitPlanOutput>>
  readonly updatePlanStep: PublicTool<
    z.infer<typeof updatePlanStepInput>,
    z.infer<typeof updatePlanStepOutput>
  >
  readonly revisePlan: PublicTool<z.infer<typeof revisePlanInput>, z.infer<typeof revisePlanOutput>>
}

export const buildPlanTools = (planState: PlanState): PlanTools => {
  const commitPlan: PublicTool<z.infer<typeof commitPlanInput>, z.infer<typeof commitPlanOutput>> = {
    name: 'commit_plan',
    description:
      'Commit to a plan of 2–20 ordered steps before executing complex work. ' +
      'Each step is a concrete action with a content (imperative) and active_form (present continuous). ' +
      'Call this BEFORE touching personal-data or special-category tools when the agent is high-risk. ' +
      'Plans are visible to operators as a live checklist and are recorded in the evidence chain.',
    input: commitPlanInput,
    output: commitPlanOutput,
    dataClassification: 'public',
    threatBoundary: PLAN_TOOL_BOUNDARY,
    retention: DEFAULT_RETENTION,
    softCancelTimeoutMs: 0,
    toolImplHash: 'fuze.builtin.commit_plan.v1',
    toolVersion: '1.0.0',
    run: async (input) => {
      try {
        const { event, version } = planState.commit({
          steps: input.steps.map((s) => ({
            content: s.content,
            activeForm: s.active_form,
            ...(s.parent_step_id !== undefined ? { parentStepId: s.parent_step_id } : {}),
          })),
        })
        return Ok({
          plan_hash: event.planHash,
          steps_committed: version.steps.length,
          step_ids: version.steps.map((s) => s.stepId),
        })
      } catch (e) {
        return Err(e instanceof PlanStateError ? new Error(e.message) : (e as Error))
      }
    },
  }

  const updatePlanStep: PublicTool<
    z.infer<typeof updatePlanStepInput>,
    z.infer<typeof updatePlanStepOutput>
  > = {
    name: 'update_plan_step',
    description:
      'Update a plan step status. Set to "in_progress" before doing the work, then "done" when complete. ' +
      'Evidence rows emitted while in_progress are auto-linked to the step. ' +
      'Use evidence_refs to add additional links; unlink_refs to correct auto-captured mistakes. ' +
      'Status is append-only: once "done", it cannot revert — to redo, revise the plan with a new step.',
    input: updatePlanStepInput,
    output: updatePlanStepOutput,
    dataClassification: 'public',
    threatBoundary: PLAN_TOOL_BOUNDARY,
    retention: DEFAULT_RETENTION,
    softCancelTimeoutMs: 0,
    toolImplHash: 'fuze.builtin.update_plan_step.v1',
    toolVersion: '1.0.0',
    run: async (input) => {
      try {
        const { event } = planState.updateStep({
          stepId: input.step_id,
          status: input.status,
          ...(input.evidence_refs ? { evidenceRefs: input.evidence_refs } : {}),
          ...(input.unlink_refs ? { unlinkRefs: input.unlink_refs } : {}),
          ...(input.note !== undefined ? { note: input.note } : {}),
        })
        return Ok({
          applied: true,
          delta_hash: event.deltaHash,
          evidence_refs: [...event.evidenceRefs],
          linkage_source: event.linkageSource,
        })
      } catch (e) {
        return Err(e instanceof PlanStateError ? new Error(e.message) : (e as Error))
      }
    },
  }

  const revisePlan: PublicTool<z.infer<typeof revisePlanInput>, z.infer<typeof revisePlanOutput>> = {
    name: 'revise_plan',
    description:
      'Structurally revise the plan: add steps (with optional derived_from for splits), remove steps ' +
      '(marked "superseded" — evidence stays linked), reorder. Rationale is required and auditable. ' +
      'Step IDs are immutable across revisions; completed steps stay completed.',
    input: revisePlanInput,
    output: revisePlanOutput,
    dataClassification: 'public',
    threatBoundary: PLAN_TOOL_BOUNDARY,
    retention: DEFAULT_RETENTION,
    softCancelTimeoutMs: 0,
    toolImplHash: 'fuze.builtin.revise_plan.v1',
    toolVersion: '1.0.0',
    run: async (input) => {
      try {
        const { event } = planState.revise({
          ...(input.add_steps
            ? {
                addSteps: input.add_steps.map((a) => ({
                  ordinal: a.ordinal,
                  content: a.content,
                  activeForm: a.active_form,
                  ...(a.parent_step_id !== undefined ? { parentStepId: a.parent_step_id } : {}),
                  ...(a.derived_from !== undefined ? { derivedFrom: a.derived_from } : {}),
                })),
              }
            : {}),
          ...(input.remove_steps ? { removeSteps: input.remove_steps } : {}),
          ...(input.reorder
            ? { reorder: input.reorder.map((r) => ({ stepId: r.step_id, ordinal: r.ordinal })) }
            : {}),
          rationale: input.rationale,
        })
        return Ok({
          version: event.version,
          plan_hash: event.planHash,
          added: [...event.added],
          removed: [...event.removed],
          reordered: [...event.reordered],
        })
      } catch (e) {
        return Err(e instanceof PlanStateError ? new Error(e.message) : (e as Error))
      }
    },
  }

  return { commitPlan, updatePlanStep, revisePlan }
}

export const PLAN_TOOL_NAMES = ['commit_plan', 'update_plan_step', 'revise_plan'] as const
export type PlanToolName = (typeof PLAN_TOOL_NAMES)[number]
export const isPlanToolName = (name: string): name is PlanToolName =>
  (PLAN_TOOL_NAMES as readonly string[]).includes(name)
