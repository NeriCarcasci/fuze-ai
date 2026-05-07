/**
 * Drift check on resume:
 *   - Art22 + snapshot drift -> ModelDriftAtResumeError
 *   - non-Art22 + snapshot drift -> proceeds (no throw)
 *   - allowModelDrift=true overrides
 */

import { describe, expect, it } from 'vitest'
import { resumeRun, ModelDriftAtResumeError } from '../src/loop/resume.js'
import { defineAgent } from '../src/agent/define-agent.js'
import { defineTool } from '../src/agent/define-tool.js'
import { z } from 'zod'
import { Ok } from '../src/types/result.js'
import { DEFAULT_RETENTION } from '../src/types/compliance.js'
import { inMemorySecrets } from '../src/agent/secrets-noop.js'
import { makeRunId, makeStepId, makeTenantId, makePrincipalId } from '../src/types/brand.js'
import { StaticPolicyEngine } from '../src/policy/static.js'
import type { SuspendedRun, OversightDecision } from '../src/types/oversight.js'
import type { FuzeModel } from '../src/types/model.js'
import type { Ed25519Verifier } from '../src/types/signing.js'
import { InMemoryNonceStore } from '../src/loop/in-memory-stores.js'

const trusted = {
  trustedCallers: ['agent-loop'] as const,
  observesSecrets: false,
  egressDomains: 'none' as const,
  readsFilesystem: false,
  writesFilesystem: false,
}

const tool = defineTool.personal({
  name: 'send_email',
  description: 'send email',
  input: z.object({ to: z.string() }),
  output: z.object({ sent: z.boolean() }),
  residencyRequired: 'eu',
  threatBoundary: trusted,
  allowedLawfulBases: ['contract'],
  retention: DEFAULT_RETENTION,
  needsApproval: () => true,
  run: async () => Ok({ sent: true }),
})

const newModel = (modelName: string): FuzeModel => ({
  providerName: 'openai-eu',
  modelName,
  residency: 'eu',
  generate: async () => ({ content: '{}', toolCalls: [], finishReason: 'stop', tokensIn: 1, tokensOut: 1 }),
})

const buildAgent = (modelName: string, art22: boolean) =>
  defineAgent({
    purpose: 'sender',
    lawfulBasis: 'contract',
    annexIIIDomain: 'employment',
    art14OversightPlan: { id: 'plan-1' },
    producesArt22Decision: art22,
    model: newModel(modelName),
    tools: [tool],
    output: z.object({}),
    maxSteps: 2,
    retryBudget: 0,
    planning: { required: false },
    deps: {},
  })

const fakeVerifier: Ed25519Verifier = {
  verify: () => Promise.resolve(true),
  publicKeyId: 'test-key',
}

const buildSuspended = (modelName: string, art22: boolean): SuspendedRun => ({
  runId: makeRunId('r1'),
  suspendedAtSpanId: makeStepId('s1'),
  suspendedAtSequence: 0,
  chainHeadAtSuspend: '0'.repeat(64),
  toolName: 'send_email',
  toolArgs: { to: 'a@b.c' },
  reason: 'requires-approval',
  resumeToken: {
    runId: makeRunId('r1'),
    suspendedAtSequence: 0,
    chainHeadAtSuspend: '0'.repeat(64),
    nonce: 'n1',
    signature: 's1',
    publicKeyId: 'test-key',
  },
  definitionFingerprint: '',
  modelSnapshotAtSuspend: { providerName: 'openai-eu', modelName, residency: 'eu' },
  art22AtSuspend: art22,
})

const buildDecision = (): OversightDecision => ({
  action: 'approve',
  rationale: 'ok',
  overseerId: 'reviewer-1',
})

describe('drift check on resume', () => {
  it('throws ModelDriftAtResumeError when Art22 + snapshot drift', async () => {
    const suspended = buildSuspended('gpt-4o-2024-08-06', true)
    const def = buildAgent('gpt-4o-2024-11-20', true)
    await expect(
      resumeRun(
        {
          definition: def,
          policy: new StaticPolicyEngine([{ id: 'a', toolName: '*', effect: 'allow' }]),
          verifier: fakeVerifier,
          nonceStore: new InMemoryNonceStore(),
          evidenceSink: () => undefined,
        },
        {
          suspended,
          decision: buildDecision(),
          tenant: makeTenantId('t'),
          principal: makePrincipalId('p'),
          secrets: inMemorySecrets(),
          priorHistory: [],
          subjectRef: { hmac: 'h', scheme: 'hmac-sha256' },
          allowDefinitionDrift: true,
        },
      ),
    ).rejects.toBeInstanceOf(ModelDriftAtResumeError)
  })

  it('does not throw when non-Art22 + snapshot drift', async () => {
    const suspended = buildSuspended('gpt-4o-2024-08-06', false)
    const def = buildAgent('gpt-4o-2024-11-20', false)
    // Doesn't throw the drift error; downstream may still error for other
    // reasons (token signature in this stub), but ModelDriftAtResumeError
    // specifically must not surface.
    let drifted = false
    try {
      await resumeRun(
        {
          definition: def,
          policy: new StaticPolicyEngine([{ id: 'a', toolName: '*', effect: 'allow' }]),
          verifier: fakeVerifier,
          nonceStore: new InMemoryNonceStore(),
          evidenceSink: () => undefined,
        },
        {
          suspended,
          decision: buildDecision(),
          tenant: makeTenantId('t'),
          principal: makePrincipalId('p'),
          secrets: inMemorySecrets(),
          priorHistory: [],
          subjectRef: { hmac: 'h', scheme: 'hmac-sha256' },
          allowDefinitionDrift: true,
        },
      )
    } catch (e) {
      drifted = e instanceof ModelDriftAtResumeError
    }
    expect(drifted).toBe(false)
  })

  it('allowModelDrift=true overrides the Art22 refusal', async () => {
    const suspended = buildSuspended('gpt-4o-2024-08-06', true)
    const def = buildAgent('gpt-4o-2024-11-20', true)
    let drifted = false
    try {
      await resumeRun(
        {
          definition: def,
          policy: new StaticPolicyEngine([{ id: 'a', toolName: '*', effect: 'allow' }]),
          verifier: fakeVerifier,
          nonceStore: new InMemoryNonceStore(),
          evidenceSink: () => undefined,
        },
        {
          suspended,
          decision: buildDecision(),
          tenant: makeTenantId('t'),
          principal: makePrincipalId('p'),
          secrets: inMemorySecrets(),
          priorHistory: [],
          subjectRef: { hmac: 'h', scheme: 'hmac-sha256' },
          allowDefinitionDrift: true,
          allowModelDrift: true,
        },
      )
    } catch (e) {
      drifted = e instanceof ModelDriftAtResumeError
    }
    expect(drifted).toBe(false)
  })
})
