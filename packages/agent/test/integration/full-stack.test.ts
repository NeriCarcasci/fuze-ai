import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { z } from 'zod'

import { LocalKeySigner, LocalKeyVerifier } from '@fuze-ai/agent-signing'
import { CerbosCompatPolicyEngine } from '@fuze-ai/agent-policy-cerbos'
import { SqliteSuspendStore } from '@fuze-ai/agent-suspend-store'
import { SqliteDurableRunStore } from '@fuze-ai/agent-durable'
import { SqliteTransparencyLog } from '@fuze-ai/agent-transparency'
import type { TransparencyEntry } from '@fuze-ai/agent-transparency'
import { RegexRedactionEngine } from '@fuze-ai/agent-redaction'

import { defineAgent } from '../../src/agent/define-agent.js'
import { defineTool } from '../../src/agent/define-tool.js'
import { inMemorySecrets } from '../../src/agent/secrets-noop.js'
import { runAgent } from '../../src/loop/loop.js'
import { resumeRun } from '../../src/loop/resume.js'
import { InMemoryNonceStore } from '../../src/loop/in-memory-stores.js'
import { verifyChain } from '../../src/evidence/hash-chain.js'
import type { ChainedRecord } from '../../src/evidence/hash-chain.js'
import type { EvidenceSpan } from '../../src/evidence/emitter.js'
import type { FuzeModel, ModelStep } from '../../src/types/model.js'
import type { ThreatBoundary, RetentionPolicy } from '../../src/types/compliance.js'
import { Ok } from '../../src/types/result.js'
import { makeTenantId, makePrincipalId } from '../../src/types/brand.js'
import type { SnapshotSink } from '../../src/loop/loop.js'

const TB: ThreatBoundary = {
  trustedCallers: ['agent-loop'],
  observesSecrets: false,
  egressDomains: 'none',
  readsFilesystem: false,
  writesFilesystem: false,
}

const RET: RetentionPolicy = {
  id: 'integration.full-stack.v1',
  hashTtlDays: 30,
  fullContentTtlDays: 7,
  decisionTtlDays: 90,
}

const ALLOW_ALL_YAML = `
apiVersion: api.cerbos.dev/v1
resourcePolicy:
  resource: "*"
  rules:
    - id: any.allow
      actions: [invoke]
      effect: EFFECT_ALLOW
`

const APPROVAL_YAML = `
apiVersion: api.cerbos.dev/v1
resourcePolicy:
  resource: send_email
  rules:
    - id: send_email.requires-approval
      actions: [invoke]
      effect: EFFECT_REQUIRES_APPROVAL
`

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

const echoTool = defineTool.public({
  name: 'echo',
  description: 'echoes a message',
  input: z.object({ text: z.string() }),
  output: z.object({ text: z.string() }),
  threatBoundary: TB,
  retention: RET,
  run: async (input) => Ok({ text: input.text }),
})

const sendEmailTool = defineTool.public({
  name: 'send_email',
  description: 'sends an email (requires approval)',
  input: z.object({ to: z.string(), body: z.string() }),
  output: z.object({ delivered: z.boolean() }),
  threatBoundary: TB,
  retention: RET,
  needsApproval: () => true,
  run: async () => Ok({ delivered: true }),
})

interface Stack {
  workDir: string
  signer: LocalKeySigner
  verifier: LocalKeyVerifier
  policyAllow: CerbosCompatPolicyEngine
  policyApproval: CerbosCompatPolicyEngine
  suspendStore: SqliteSuspendStore
  durableStore: SqliteDurableRunStore
  transparencyLog: SqliteTransparencyLog
  redaction: RegexRedactionEngine
  nonceStore: InMemoryNonceStore
}

const makeStack = (): Stack => {
  const workDir = mkdtempSync(path.join(os.tmpdir(), 'fuze-fullstack-'))
  const signer = new LocalKeySigner({ keyPath: path.join(workDir, 'agent-key') })
  const verifier = LocalKeyVerifier.fromSigner(signer)
  return {
    workDir,
    signer,
    verifier,
    policyAllow: new CerbosCompatPolicyEngine([ALLOW_ALL_YAML]),
    policyApproval: new CerbosCompatPolicyEngine([APPROVAL_YAML]),
    suspendStore: new SqliteSuspendStore({ databasePath: ':memory:' }),
    durableStore: new SqliteDurableRunStore({ databasePath: ':memory:' }),
    transparencyLog: new SqliteTransparencyLog({ databasePath: ':memory:' }),
    redaction: new RegexRedactionEngine(),
    nonceStore: new InMemoryNonceStore(),
  }
}

const teardown = (stack: Stack): void => {
  stack.suspendStore.close()
  stack.durableStore.close()
  stack.transparencyLog.close()
  rmSync(stack.workDir, { recursive: true, force: true })
}

const snapshotSinkFor = (stack: Stack, tenant: string, principal: string): SnapshotSink => ({
  save: async (snap) => {
    await stack.durableStore.save({
      runId: snap.runId,
      tenant,
      principal,
      stepsUsed: snap.stepsUsed,
      retriesUsed: snap.retriesUsed,
      chainHead: snap.chainHead,
      lastSequence: snap.lastSequence,
      history: snap.history,
      completedToolCalls: [],
      ...(snap.suspendedToolName !== undefined ? { suspendedToolName: snap.suspendedToolName } : {}),
      ...(snap.suspendedToolArgs !== undefined ? { suspendedToolArgs: snap.suspendedToolArgs } : {}),
      snapshotAt: new Date().toISOString(),
    })
  },
})

const anchorRun = async (
  stack: Stack,
  records: readonly ChainedRecord<EvidenceSpan>[],
  runId: string,
): Promise<{ logIndex: number }> => {
  const head = records[records.length - 1]?.hash ?? '0'.repeat(64)
  const message = new TextEncoder().encode(`${runId}:${head}`)
  const sig = await stack.signer.sign(message)
  const entry: TransparencyEntry = {
    runId,
    chainHead: head,
    signedRunRoot: {
      runId,
      chainHead: head,
      nonce: `nonce-${runId}`,
      signature: Buffer.from(sig).toString('base64'),
      publicKeyId: stack.signer.publicKeyId,
      algorithm: 'ed25519',
    },
    observedAt: new Date().toISOString(),
  }
  return stack.transparencyLog.append(entry)
}

describe('integration: full-stack agent run', () => {
  let stack: Stack
  beforeEach(() => {
    stack = makeStack()
  })
  afterEach(() => {
    teardown(stack)
  })

  it('clean run completes end-to-end with chain validation, transparency anchor, and durable snapshot', async () => {
    const records: ChainedRecord<EvidenceSpan>[] = []
    const piiPayload = 'reply to user@example.com please'
    const redacted = await stack.redaction.redact({ message: piiPayload })
    expect(redacted.findings.find((f) => f.kind === 'email')).toBeDefined()

    const agent = defineAgent({
      purpose: 'echo-bot-fullstack',
      lawfulBasis: 'consent',
      annexIIIDomain: 'none',
      producesArt22Decision: false,
      model: fakeModel([
        {
          content: '',
          toolCalls: [{ id: 't1', name: 'echo', args: { text: 'hi' } }],
          finishReason: 'tool_calls',
          tokensIn: 10,
          tokensOut: 5,
        },
        {
          content: '{"final":"hi"}',
          toolCalls: [],
          finishReason: 'stop',
          tokensIn: 12,
          tokensOut: 4,
        },
      ]),
      tools: [echoTool],
      output: z.object({ final: z.string() }),
      maxSteps: 5,
      retryBudget: 0,
      deps: {},
    })

    const result = await runAgent(
      {
        definition: agent,
        policy: stack.policyAllow,
        evidenceSink: (r) => records.push(r),
        signer: stack.signer,
        snapshotSink: snapshotSinkFor(stack, 't-1', 'p-1'),
      },
      {
        tenant: makeTenantId('t-1'),
        principal: makePrincipalId('p-1'),
        secrets: inMemorySecrets({}),
        userMessage: 'echo hi',
      },
    )

    expect(result.status).toBe('completed')
    expect(verifyChain(records)).toBe(true)
    expect(records.length).toBeGreaterThan(0)

    const anchor = await anchorRun(stack, records, result.runId)
    expect(anchor.logIndex).toBe(1)

    const snapshot = await stack.durableStore.load(result.runId)
    expect(snapshot).not.toBeNull()
    expect(snapshot?.runId).toBe(result.runId)
  })

  it('HITL suspend → approve → resume completes with full evidence trail', async () => {
    const records: ChainedRecord<EvidenceSpan>[] = []

    const agent = defineAgent({
      purpose: 'approval-flow',
      lawfulBasis: 'consent',
      annexIIIDomain: 'none',
      producesArt22Decision: false,
      model: fakeModel([
        {
          content: '',
          toolCalls: [{ id: 'c1', name: 'send_email', args: { to: 'a@b.com', body: 'hi' } }],
          finishReason: 'tool_calls',
          tokensIn: 5,
          tokensOut: 3,
        },
        {
          content: '{"final":"sent"}',
          toolCalls: [],
          finishReason: 'stop',
          tokensIn: 4,
          tokensOut: 4,
        },
      ]),
      tools: [sendEmailTool],
      output: z.object({ final: z.string() }),
      maxSteps: 5,
      retryBudget: 0,
      deps: {},
    })

    const suspendResult = await runAgent(
      {
        definition: agent,
        policy: stack.policyApproval,
        evidenceSink: (r) => records.push(r),
        signer: stack.signer,
        snapshotSink: snapshotSinkFor(stack, 't-1', 'p-1'),
      },
      {
        tenant: makeTenantId('t-1'),
        principal: makePrincipalId('p-1'),
        secrets: inMemorySecrets({}),
        userMessage: 'send the email',
      },
    )

    expect(suspendResult.status).toBe('suspended')
    expect(suspendResult.suspended).toBeDefined()

    await stack.suspendStore.save(suspendResult.suspended!)
    const loaded = await stack.suspendStore.load(suspendResult.suspended!.runId)
    expect(loaded).not.toBeNull()
    expect(loaded?.toolName).toBe('send_email')

    const continued = await resumeRun(
      {
        definition: agent,
        policy: stack.policyAllow,
        verifier: stack.verifier,
        nonceStore: stack.nonceStore,
        evidenceSink: (r) => records.push(r),
      },
      {
        suspended: loaded!,
        decision: {
          action: 'approve',
          rationale: 'overseer reviewed',
          overseerId: 'overseer-1',
          trainingId: 'cert-2026-q1',
        },
        tenant: makeTenantId('t-1'),
        principal: makePrincipalId('p-1'),
        secrets: inMemorySecrets({}),
        priorHistory: [],
      },
    )

    expect(continued.status).toBe('completed')
    expect(verifyChain(records)).toBe(true)
    await stack.suspendStore.markResumed(loaded!.runId, {
      action: 'approve',
      rationale: 'ok',
      overseerId: 'overseer-1',
    })

    const anchor = await anchorRun(stack, records, suspendResult.runId)
    expect(anchor.logIndex).toBe(1)

    const decisionSpan = records.find((r) => r.payload.span === 'oversight.decision')
    expect(decisionSpan).toBeDefined()
  })

  it('HITL suspend → reject → halts without continuation', async () => {
    const records: ChainedRecord<EvidenceSpan>[] = []

    const agent = defineAgent({
      purpose: 'rejection-flow',
      lawfulBasis: 'consent',
      annexIIIDomain: 'none',
      producesArt22Decision: false,
      model: fakeModel([
        {
          content: '',
          toolCalls: [{ id: 'c1', name: 'send_email', args: { to: 'a@b.com', body: 'hi' } }],
          finishReason: 'tool_calls',
          tokensIn: 5,
          tokensOut: 3,
        },
      ]),
      tools: [sendEmailTool],
      output: z.object({ final: z.string() }),
      maxSteps: 5,
      retryBudget: 0,
      deps: {},
    })

    const suspendResult = await runAgent(
      {
        definition: agent,
        policy: stack.policyApproval,
        evidenceSink: (r) => records.push(r),
        signer: stack.signer,
      },
      {
        tenant: makeTenantId('t-1'),
        principal: makePrincipalId('p-1'),
        secrets: inMemorySecrets({}),
        userMessage: 'send the email',
      },
    )

    expect(suspendResult.status).toBe('suspended')
    await stack.suspendStore.save(suspendResult.suspended!)

    const rejected = await resumeRun(
      {
        definition: agent,
        policy: stack.policyAllow,
        verifier: stack.verifier,
        nonceStore: stack.nonceStore,
        evidenceSink: (r) => records.push(r),
      },
      {
        suspended: suspendResult.suspended!,
        decision: {
          action: 'reject',
          rationale: 'no — risky email',
          overseerId: 'overseer-2',
        },
        tenant: makeTenantId('t-1'),
        principal: makePrincipalId('p-1'),
        secrets: inMemorySecrets({}),
        priorHistory: [],
      },
    )

    expect(rejected.status).toBe('tripwire')
    expect(verifyChain(records)).toBe(true)
    const decisionSpan = records.find((r) => r.payload.span === 'oversight.decision')
    expect(decisionSpan?.payload.attrs['fuze.oversight.action']).toBe('reject')
    const toolExec = records.filter((r) => r.payload.span === 'tool.execute')
    expect(toolExec.length).toBe(0)

    const anchor = await anchorRun(stack, records, suspendResult.runId)
    expect(anchor.logIndex).toBe(1)
  })
})
