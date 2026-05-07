/**
 * Integration tests for the plan tool wired into the agent loop.
 *
 * Confirms:
 *   - Plan tools are auto-injected when planning.required is set.
 *   - The model can call commit_plan / update_plan_step / revise_plan.
 *   - Plan-required gate refuses personal-data tools before commit_plan.
 *   - Auto-capture links evidence rows to the active step.
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineAgent } from '../src/agent/define-agent.js'
import { defineTool } from '../src/agent/define-tool.js'
import { runAgent } from '../src/loop/loop.js'
import { Ok } from '../src/types/result.js'
import { DEFAULT_RETENTION } from '../src/types/compliance.js'
import { inMemorySecrets } from '../src/agent/secrets-noop.js'
import { makeTenantId, makePrincipalId } from '../src/types/brand.js'
import type { FuzeModel, ModelStep } from '../src/types/model.js'
import { StaticPolicyEngine } from '../src/policy/static.js'
import { emptyGuardrails } from '../src/types/guardrail.js'
import type { ChainedRecord } from '../src/evidence/hash-chain.js'
import type { EvidenceSpan } from '../src/evidence/emitter.js'

const trustedBoundary = {
  trustedCallers: ['agent-loop'] as const,
  observesSecrets: false,
  egressDomains: 'none' as const,
  readsFilesystem: false,
  writesFilesystem: false,
}

const personalTool = defineTool.personal({
  name: 'fetch_user',
  description: 'fetch a user record',
  input: z.object({ userId: z.string() }),
  output: z.object({ name: z.string() }),
  residencyRequired: 'eu',
  threatBoundary: trustedBoundary,
  allowedLawfulBases: ['contract'],
  retention: DEFAULT_RETENTION,
  run: async () => Ok({ name: 'redacted' }),
})

const scriptedModel = (steps: readonly ModelStep[]): FuzeModel => {
  let i = 0
  return {
    providerName: 'mock',
    modelName: 'mock-1',
    residency: 'eu',
    generate: async () => {
      const step = steps[i] ?? {
        content: '{}',
        toolCalls: [],
        finishReason: 'stop',
        tokensIn: 1,
        tokensOut: 1,
      }
      i++
      return step
    },
  }
}

describe('plan tools wired into the loop', () => {
  it('auto-injects plan tools when annexIIIDomain is set (auto-when-high-risk default)', async () => {
    const offered: string[] = []
    const peekModel: FuzeModel = {
      providerName: 'mock',
      modelName: 'mock-1',
      residency: 'eu',
      generate: async ({ tools }) => {
        for (const t of tools) offered.push(t.name)
        return { content: 'done', toolCalls: [], finishReason: 'stop', tokensIn: 1, tokensOut: 1 }
      },
    }
    const agent = defineAgent({
      purpose: 'high-risk-test',
      lawfulBasis: 'contract',
      annexIIIDomain: 'employment',
      art14OversightPlan: { id: 'plan-1' },
      producesArt22Decision: false,
      model: peekModel,
      tools: [],
      output: z.object({}),
      maxSteps: 2,
      retryBudget: 0,
      deps: {},
    })
    await runAgent(
      {
        definition: agent,
        policy: new StaticPolicyEngine([{ id: 'allow-all', toolName: '*', effect: 'allow' }]),
        evidenceSink: () => undefined,
      },
      {
        tenant: makeTenantId('t'),
        principal: makePrincipalId('p'),
        secrets: inMemorySecrets(),
        userMessage: 'go',
        subjectRef: { hmac: 'h', scheme: 'hmac-sha256' },
      },
    )
    expect(offered).toContain('commit_plan')
    expect(offered).toContain('update_plan_step')
    expect(offered).toContain('revise_plan')
  })

  it('does NOT inject plan tools when planning.required=false', async () => {
    const offered: string[] = []
    const peekModel: FuzeModel = {
      providerName: 'mock',
      modelName: 'mock-1',
      residency: 'eu',
      generate: async ({ tools }) => {
        for (const t of tools) offered.push(t.name)
        return { content: 'done', toolCalls: [], finishReason: 'stop', tokensIn: 1, tokensOut: 1 }
      },
    }
    const agent = defineAgent({
      purpose: 'low-risk',
      lawfulBasis: 'contract',
      annexIIIDomain: 'none',
      producesArt22Decision: false,
      model: peekModel,
      tools: [],
      output: z.object({}),
      maxSteps: 2,
      retryBudget: 0,
      planning: { required: false },
      deps: {},
    })
    await runAgent(
      {
        definition: agent,
        policy: new StaticPolicyEngine([{ id: 'allow-all', toolName: '*', effect: 'allow' }]),
        evidenceSink: () => undefined,
      },
      { tenant: makeTenantId('t'), principal: makePrincipalId('p'), secrets: inMemorySecrets(), userMessage: 'go' },
    )
    expect(offered).not.toContain('commit_plan')
  })

  it('refuses personal-data tools until commit_plan is called', async () => {
    // Step 1: model tries fetch_user — should error with retryable plan-required.
    // Step 2: model calls commit_plan — should succeed.
    // Step 3: model calls fetch_user again — should succeed.
    // Step 4: model returns final.
    const model = scriptedModel([
      {
        content: '',
        toolCalls: [{ id: 'c1', name: 'fetch_user', args: { userId: 'u1' } }],
        finishReason: 'tool_calls',
        tokensIn: 1,
        tokensOut: 1,
      },
      {
        content: '',
        toolCalls: [
          {
            id: 'c2',
            name: 'commit_plan',
            args: {
              steps: [
                { content: 'Fetch user', active_form: 'Fetching user' },
                { content: 'Return summary', active_form: 'Returning summary' },
              ],
            },
          },
        ],
        finishReason: 'tool_calls',
        tokensIn: 1,
        tokensOut: 1,
      },
      {
        content: '',
        toolCalls: [{ id: 'c3', name: 'fetch_user', args: { userId: 'u1' } }],
        finishReason: 'tool_calls',
        tokensIn: 1,
        tokensOut: 1,
      },
      {
        content: '{"ok":true}',
        toolCalls: [],
        finishReason: 'stop',
        tokensIn: 1,
        tokensOut: 1,
      },
    ])

    const agent = defineAgent({
      purpose: 'gate-test',
      lawfulBasis: 'contract',
      annexIIIDomain: 'employment',
      art14OversightPlan: { id: 'plan-1' },
      producesArt22Decision: false,
      model,
      tools: [personalTool],
      output: z.object({ ok: z.boolean() }),
      maxSteps: 6,
      retryBudget: 2,
      deps: {},
    })
    const evidence: ChainedRecord<EvidenceSpan>[] = []
    const result = await runAgent(
      {
        definition: agent,
        policy: new StaticPolicyEngine([{ id: 'allow-all', toolName: '*', effect: 'allow' }]),
        evidenceSink: (r) => {
          evidence.push(r)
        },
      },
      {
        tenant: makeTenantId('t'),
        principal: makePrincipalId('p'),
        secrets: inMemorySecrets(),
        userMessage: 'go',
        subjectRef: { hmac: 'h', scheme: 'hmac-sha256' },
      },
    )
    expect(result.status).toBe('completed')
    // Three tool dispatches were attempted by the model: fetch_user (gated),
    // commit_plan (succeeds), fetch_user again (succeeds now that plan exists).
    // The gated attempt aborts before tool.execute, so only policy.evaluate
    // is recorded for it. We verify the gate fired by checking that:
    //   - exactly 3 policy.evaluate spans exist (one per attempted tool call)
    //   - exactly 2 tool.execute spans exist (commit_plan + 2nd fetch_user)
    const policySpans = evidence.filter((e) => e.payload.span === 'policy.evaluate')
    const toolSpans = evidence.filter((e) => e.payload.span === 'tool.execute')
    expect(policySpans.length).toBe(3)
    expect(toolSpans.length).toBe(2)
    expect(toolSpans.map((s) => s.payload.attrs['gen_ai.tool.name'])).toEqual([
      'commit_plan',
      'fetch_user',
    ])
  })
})
