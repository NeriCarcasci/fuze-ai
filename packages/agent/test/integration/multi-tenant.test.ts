import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'

import { SqliteSuspendStore } from '@fuze-ai/agent-suspend-store'
import { SqliteSpansStore } from '@fuze-ai/agent-api-server'

import { defineAgent } from '../../src/agent/define-agent.js'
import { defineTool } from '../../src/agent/define-tool.js'
import { inMemorySecrets } from '../../src/agent/secrets-noop.js'
import { runAgent } from '../../src/loop/loop.js'
import { StaticPolicyEngine } from '../../src/policy/static.js'
import {
  InProcessSandbox,
  SimpleTenantWatchdog,
} from '../../src/sandbox/in-process.js'
import { SandboxRefusedError } from '../../src/sandbox/types.js'
import type { ChainedRecord } from '../../src/evidence/hash-chain.js'
import type { EvidenceSpan } from '../../src/evidence/emitter.js'
import type { FuzeModel, ModelStep } from '../../src/types/model.js'
import type {
  ThreatBoundary,
  RetentionPolicy,
} from '../../src/types/compliance.js'
import { Ok } from '../../src/types/result.js'
import {
  makeTenantId,
  makePrincipalId,
  makeRunId,
  makeStepId,
} from '../../src/types/brand.js'
import type { Ctx } from '../../src/types/ctx.js'
import type { SuspendedRun } from '../../src/types/oversight.js'

const TB: ThreatBoundary = {
  trustedCallers: ['agent-loop'],
  observesSecrets: false,
  egressDomains: 'none',
  readsFilesystem: false,
  writesFilesystem: false,
}
const RET: RetentionPolicy = {
  id: 'integration.tenant.v1',
  hashTtlDays: 30,
  fullContentTtlDays: 7,
  decisionTtlDays: 90,
}

const echoTool = defineTool.public({
  name: 'echo',
  description: 'echoes',
  input: z.object({ text: z.string() }),
  output: z.object({ text: z.string() }),
  threatBoundary: TB,
  retention: RET,
  run: async (input) => Ok({ text: input.text }),
})

const fakeModel = (steps: ModelStep[]): FuzeModel => {
  let i = 0
  return {
    providerName: 'fake',
    modelName: 'fake-1',
    residency: 'eu',
    generate: async () => {
      const s = steps[i++]
      if (!s) throw new Error('fakeModel exhausted')
      return s
    },
  }
}

const buildAgent = (purpose: string) =>
  defineAgent({
    purpose,
    lawfulBasis: 'consent',
    annexIIIDomain: 'none',
    producesArt22Decision: false,
    model: fakeModel([
      {
        content: '',
        toolCalls: [{ id: 't1', name: 'echo', args: { text: purpose } }],
        finishReason: 'tool_calls',
        tokensIn: 1,
        tokensOut: 1,
      },
      {
        content: '{"final":"done"}',
        toolCalls: [],
        finishReason: 'stop',
        tokensIn: 1,
        tokensOut: 1,
      },
    ]),
    tools: [echoTool],
    output: z.object({ final: z.string() }),
    maxSteps: 5,
    retryBudget: 0,
    deps: {},
  })

const makeSuspendedFor = (runId: string): SuspendedRun => ({
  runId: runId as never,
  suspendedAtSpanId: `step-${runId}` as never,
  suspendedAtSequence: 1,
  chainHeadAtSuspend: 'a'.repeat(64),
  toolName: 'echo',
  toolArgs: { text: runId },
  reason: 'pending',
  resumeToken: {
    runId: runId as never,
    suspendedAtSequence: 1,
    chainHeadAtSuspend: 'a'.repeat(64),
    nonce: `n-${runId}`,
    signature: 'sig',
    publicKeyId: 'kid-1',
  },
  definitionFingerprint: 'fp-1',
})

describe('integration: multi-tenant isolation', () => {
  let suspendStore: SqliteSuspendStore
  let spansStore: SqliteSpansStore

  beforeEach(() => {
    suspendStore = new SqliteSuspendStore({ databasePath: ':memory:' })
    spansStore = new SqliteSpansStore({ databasePath: ':memory:' })
  })

  afterEach(() => {
    suspendStore.close()
    spansStore.close()
  })

  it('suspend store: tenant A and tenant B writes do not leak into each other', async () => {
    await suspendStore.saveWithSubject(makeSuspendedFor('run-a-1'), 'subj-a')
    await suspendStore.saveWithSubject(makeSuspendedFor('run-b-1'), 'subj-b')
    await suspendStore.saveWithSubject(makeSuspendedFor('run-a-2'), 'subj-a')

    const erasedA = await suspendStore.eraseBySubjectRef('subj-a')
    expect(erasedA).toBe(2)
    expect(await suspendStore.load(makeRunId('run-a-1'))).toBeNull()
    expect(await suspendStore.load(makeRunId('run-a-2'))).toBeNull()
    expect(await suspendStore.load(makeRunId('run-b-1'))).not.toBeNull()
  })

  it('spans store: each tenant queries see only their own runs', async () => {
    const recordsA: ChainedRecord<EvidenceSpan>[] = []
    const recordsB: ChainedRecord<EvidenceSpan>[] = []

    const runA = await runAgent(
      {
        definition: buildAgent('agent-a'),
        policy: new StaticPolicyEngine([
          { id: 'allow.echo', toolName: 'echo', effect: 'allow' },
        ]),
        evidenceSink: (r) => recordsA.push(r),
      },
      {
        tenant: makeTenantId('tenant-a'),
        principal: makePrincipalId('p-a'),
        secrets: inMemorySecrets({}),
        userMessage: 'go',
      },
    )
    const runB = await runAgent(
      {
        definition: buildAgent('agent-b'),
        policy: new StaticPolicyEngine([
          { id: 'allow.echo', toolName: 'echo', effect: 'allow' },
        ]),
        evidenceSink: (r) => recordsB.push(r),
      },
      {
        tenant: makeTenantId('tenant-b'),
        principal: makePrincipalId('p-b'),
        secrets: inMemorySecrets({}),
        userMessage: 'go',
      },
    )
    expect(runA.status).toBe('completed')
    expect(runB.status).toBe('completed')

    await spansStore.append({ tenantId: 'tenant-a', records: recordsA })
    await spansStore.append({ tenantId: 'tenant-b', records: recordsB })

    const queryA = await spansStore.byRun({ tenantId: 'tenant-a', runId: runA.runId })
    expect(queryA.length).toBe(recordsA.length)

    const queryAFromB = await spansStore.byRun({ tenantId: 'tenant-b', runId: runA.runId })
    expect(queryAFromB.length).toBe(0)

    const queryBFromA = await spansStore.byRun({ tenantId: 'tenant-a', runId: runB.runId })
    expect(queryBFromA.length).toBe(0)
  })

  it('subject erasure for tenant A leaves tenant B data intact', async () => {
    const recordsA: ChainedRecord<EvidenceSpan>[] = []
    const recordsB: ChainedRecord<EvidenceSpan>[] = []
    const subjectA = { hmac: 'subj-a-hmac', scheme: 'hmac-sha256' as const }
    const subjectB = { hmac: 'subj-b-hmac', scheme: 'hmac-sha256' as const }

    await runAgent(
      {
        definition: buildAgent('agent-a'),
        policy: new StaticPolicyEngine([
          { id: 'allow.echo', toolName: 'echo', effect: 'allow' },
        ]),
        evidenceSink: (r) => recordsA.push(r),
      },
      {
        tenant: makeTenantId('tenant-a'),
        principal: makePrincipalId('p-a'),
        subjectRef: subjectA,
        secrets: inMemorySecrets({}),
        userMessage: 'go',
      },
    )
    await runAgent(
      {
        definition: buildAgent('agent-b'),
        policy: new StaticPolicyEngine([
          { id: 'allow.echo', toolName: 'echo', effect: 'allow' },
        ]),
        evidenceSink: (r) => recordsB.push(r),
      },
      {
        tenant: makeTenantId('tenant-b'),
        principal: makePrincipalId('p-b'),
        subjectRef: subjectB,
        secrets: inMemorySecrets({}),
        userMessage: 'go',
      },
    )

    await spansStore.append({ tenantId: 'tenant-a', records: recordsA })
    await spansStore.append({ tenantId: 'tenant-b', records: recordsB })

    const fromA = await spansStore.bySubject({
      tenantId: 'tenant-a',
      subjectHmac: subjectA.hmac,
    })
    expect(fromA.length).toBeGreaterThan(0)

    const crossLeak = await spansStore.bySubject({
      tenantId: 'tenant-b',
      subjectHmac: subjectA.hmac,
    })
    expect(crossLeak.length).toBe(0)
  })

  it('InProcessSandbox refuses second tenant within the watchdog window', async () => {
    const watchdog = new SimpleTenantWatchdog()
    const sandbox = new InProcessSandbox({ tenantWatchdog: watchdog })
    const ctxA: Ctx<unknown> = {
      tenant: makeTenantId('tenant-a'),
      principal: makePrincipalId('p-a'),
      runId: makeRunId('r-a'),
      stepId: makeStepId('s-a'),
      deps: {},
      secrets: { ref: () => ({} as never), resolve: async () => '' },
      attribute: () => undefined,
      invoke: async () => {
        throw new Error('not used')
      },
    }
    const ctxB: Ctx<unknown> = { ...ctxA, tenant: makeTenantId('tenant-b') }

    const a = await sandbox.exec({ command: 'echo a' }, ctxA)
    expect(a.exitCode).toBe(0)
    await expect(sandbox.exec({ command: 'echo b' }, ctxB)).rejects.toBeInstanceOf(
      SandboxRefusedError,
    )
  })
})
