import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import { generateKeyPairSync, sign, verify } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { defineAgent } from '../../src/agent/define-agent.js'
import { defineTool } from '../../src/agent/define-tool.js'
import { inMemorySecrets } from '../../src/agent/secrets-noop.js'
import { runAgent } from '../../src/loop/loop.js'
import { resumeRun } from '../../src/loop/resume.js'
import { InMemoryNonceStore } from '../../src/loop/in-memory-stores.js'
import { StaticPolicyEngine } from '../../src/policy/static.js'
import { verifyChain } from '../../src/evidence/hash-chain.js'
import { makeTenantId, makePrincipalId, makeRunId } from '../../src/types/brand.js'
import { Ok } from '../../src/types/result.js'
import type { ChainedRecord } from '../../src/evidence/hash-chain.js'
import type { EvidenceSpan } from '../../src/evidence/emitter.js'
import type { FuzeModel, ModelStep } from '../../src/types/model.js'
import type { ThreatBoundary, RetentionPolicy } from '../../src/types/compliance.js'
import type { Ed25519Signer, Ed25519Verifier } from '../../src/types/signing.js'
import type { SuspendedRun } from '../../src/types/oversight.js'

import { SqliteSuspendStore } from '@fuze-ai/agent-suspend-store'
import { SqliteDurableRunStore } from '@fuze-ai/agent-durable'

const TB: ThreatBoundary = {
  trustedCallers: ['agent-loop'],
  observesSecrets: false,
  egressDomains: 'none',
  readsFilesystem: false,
  writesFilesystem: false,
}

const RET: RetentionPolicy = {
  id: 'durability.test.v1',
  hashTtlDays: 30,
  fullContentTtlDays: 7,
  decisionTtlDays: 90,
}

const makeKeyPair = (): { signer: Ed25519Signer; verifier: Ed25519Verifier } => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const id = 'durability-key'
  return {
    signer: { publicKeyId: id, sign: async (m) => sign(null, Buffer.from(m), privateKey) },
    verifier: {
      verify: async (kid, m, s) =>
        kid === id && verify(null, Buffer.from(m), publicKey, Buffer.from(s)),
    },
  }
}

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

const sensitive = defineTool.public({
  name: 'transfer',
  description: 'sensitive op',
  input: z.object({ amount: z.number() }),
  output: z.object({ confirmation: z.string(), amount: z.number() }),
  threatBoundary: TB,
  retention: RET,
  needsApproval: () => true,
  run: async (input) => Ok({ confirmation: `transferred ${input.amount}`, amount: input.amount }),
})

const writeSpansJsonl = (
  path: string,
  records: readonly ChainedRecord<EvidenceSpan>[],
): void => {
  const lines = records.map((r) => JSON.stringify(r))
  writeFileSync(path, lines.join('\n') + (lines.length > 0 ? '\n' : ''), 'utf8')
}

const readSpansJsonl = (path: string): ChainedRecord<EvidenceSpan>[] => {
  if (!existsSync(path)) return []
  const text = readFileSync(path, 'utf8')
  if (text.length === 0) return []
  return text
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as ChainedRecord<EvidenceSpan>)
}

interface SuspendArtifacts {
  readonly suspendDbPath: string
  readonly durableDbPath: string
  readonly spansPath: string
  readonly runId: string
  readonly suspended: SuspendedRun
}

const buildAgent = (steps: ModelStep[]) =>
  defineAgent({
    purpose: 'durability-test',
    lawfulBasis: 'consent',
    annexIIIDomain: 'none',
    producesArt22Decision: false,
    model: fakeModel(steps),
    tools: [sensitive],
    output: z.object({ result: z.string() }),
    maxSteps: 3,
    retryBudget: 0,
    deps: {},
    retention: RET,
  })

const runUntilSuspend = async (tmpDir: string): Promise<SuspendArtifacts> => {
  const suspendDbPath = join(tmpDir, 'suspend.db')
  const durableDbPath = join(tmpDir, 'durable.db')
  const spansPath = join(tmpDir, 'spans.jsonl')

  const { signer } = makeKeyPair()
  const initialRecords: ChainedRecord<EvidenceSpan>[] = []

  const initialAgent = buildAgent([
    {
      content: '',
      toolCalls: [{ id: 'c1', name: 'transfer', args: { amount: 100 } }],
      finishReason: 'tool_calls',
      tokensIn: 5,
      tokensOut: 5,
    },
  ])

  const tenant = makeTenantId('t-durability')
  const principal = makePrincipalId('p-durability')

  const suspendStore = new SqliteSuspendStore({ databasePath: suspendDbPath })
  const durableStore = new SqliteDurableRunStore({ databasePath: durableDbPath })

  const result = await runAgent(
    {
      definition: initialAgent,
      policy: new StaticPolicyEngine([
        { id: 'a', toolName: 'transfer', effect: 'requires-approval' },
      ]),
      evidenceSink: (r) => initialRecords.push(r),
      signer,
      snapshotSink: {
        save: async (snapshot) => {
          await durableStore.save({
            runId: snapshot.runId,
            tenant: tenant as unknown as string,
            principal: principal as unknown as string,
            stepsUsed: snapshot.stepsUsed,
            retriesUsed: snapshot.retriesUsed,
            chainHead: snapshot.chainHead,
            lastSequence: snapshot.lastSequence,
            history: snapshot.history,
            completedToolCalls: [],
            ...(snapshot.suspendedToolName !== undefined
              ? { suspendedToolName: snapshot.suspendedToolName }
              : {}),
            ...(snapshot.suspendedToolArgs !== undefined
              ? { suspendedToolArgs: snapshot.suspendedToolArgs }
              : {}),
            snapshotAt: new Date().toISOString(),
          })
        },
      },
    },
    {
      tenant,
      principal,
      secrets: inMemorySecrets({}),
      userMessage: 'transfer 100',
    },
  )

  expect(result.status).toBe('suspended')
  expect(result.suspended).toBeDefined()
  expect(verifyChain(initialRecords)).toBe(true)

  await suspendStore.save(result.suspended!)
  writeSpansJsonl(spansPath, initialRecords)

  suspendStore.close()
  durableStore.close()

  return {
    suspendDbPath,
    durableDbPath,
    spansPath,
    runId: result.runId,
    suspended: result.suspended!,
  }
}

interface ResumeOutcome {
  readonly status: string
  readonly preRecords: readonly ChainedRecord<EvidenceSpan>[]
  readonly postRecords: readonly ChainedRecord<EvidenceSpan>[]
  readonly stitched: readonly ChainedRecord<EvidenceSpan>[]
  readonly chainValid: boolean
  readonly finalChainHead: string
}

const resumeFromDisk = async (
  artifacts: SuspendArtifacts,
  decision: { action: 'approve' | 'reject' | 'override'; rationale: string; overseerId: string; overrideArgs?: Readonly<Record<string, unknown>> },
  continuationModelOutput = '{"result":"done"}',
): Promise<ResumeOutcome> => {
  const reopenedSuspendStore = new SqliteSuspendStore({
    databasePath: artifacts.suspendDbPath,
  })
  const reopenedDurableStore = new SqliteDurableRunStore({
    databasePath: artifacts.durableDbPath,
  })

  const reloadedSuspended = await reopenedSuspendStore.load(makeRunId(artifacts.runId))
  expect(reloadedSuspended).toBeDefined()
  if (!reloadedSuspended) throw new Error('suspended run missing after reload')

  const reloadedSnapshot = await reopenedDurableStore.load(artifacts.runId)
  expect(reloadedSnapshot).toBeDefined()
  if (!reloadedSnapshot) throw new Error('durable snapshot missing after reload')

  const preRecords = readSpansJsonl(artifacts.spansPath)
  expect(preRecords.length).toBeGreaterThan(0)
  expect(verifyChain(preRecords)).toBe(true)

  const { verifier } = makeKeyPair()
  const trustingVerifier: Ed25519Verifier = {
    verify: async (_kid, _msg, _sig) => true,
  }
  void verifier

  const postRecords: ChainedRecord<EvidenceSpan>[] = []
  const continuationAgent = buildAgent([
    {
      content: continuationModelOutput,
      toolCalls: [],
      finishReason: 'stop',
      tokensIn: 5,
      tokensOut: 5,
    },
  ])

  const result = await resumeRun(
    {
      definition: continuationAgent,
      policy: new StaticPolicyEngine([{ id: 'b', toolName: '*', effect: 'allow' }]),
      verifier: trustingVerifier,
      nonceStore: new InMemoryNonceStore(),
      evidenceSink: (r) => postRecords.push(r),
    },
    {
      suspended: reloadedSuspended,
      decision: decision.overrideArgs
        ? {
            action: 'override',
            rationale: decision.rationale,
            overseerId: decision.overseerId,
            overrideArgs: decision.overrideArgs,
          }
        : decision.action === 'reject'
          ? { action: 'reject', rationale: decision.rationale, overseerId: decision.overseerId }
          : { action: 'approve', rationale: decision.rationale, overseerId: decision.overseerId },
      tenant: makeTenantId('t-durability'),
      principal: makePrincipalId('p-durability'),
      secrets: inMemorySecrets({}),
      priorHistory: reloadedSnapshot.history,
    },
  )

  reopenedSuspendStore.close()
  reopenedDurableStore.close()

  const stitched = [...preRecords, ...postRecords]

  return {
    status: result.status,
    preRecords,
    postRecords,
    stitched,
    chainValid: verifyChain(stitched),
    finalChainHead: result.evidenceHashChainHead,
  }
}

describe('process-restart durability', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'fuze-durability-'))
  })

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // best-effort cleanup
    }
  })

  it('clean approve: persists, restarts (fresh stores + fresh emitter), resumes, stitched chain is valid', async () => {
    const artifacts = await runUntilSuspend(tmpDir)
    const outcome = await resumeFromDisk(artifacts, {
      action: 'approve',
      rationale: 'within budget',
      overseerId: 'overseer-1',
    })
    expect(outcome.status).toBe('completed')
    expect(outcome.chainValid).toBe(true)
    expect(outcome.preRecords.length).toBeGreaterThan(0)
    expect(outcome.postRecords.length).toBeGreaterThan(0)
    const oversight = outcome.postRecords.find((r) => r.payload.span === 'oversight.decision')
    expect(oversight).toBeDefined()
    const approved = outcome.postRecords.find((r) => r.payload.span === 'tool.execute.approved')
    expect(approved).toBeDefined()
  })

  it('reject: continuation halts as tripwire after restart, no tool execution', async () => {
    const artifacts = await runUntilSuspend(tmpDir)
    const outcome = await resumeFromDisk(artifacts, {
      action: 'reject',
      rationale: 'unauthorised',
      overseerId: 'overseer-2',
    })
    expect(outcome.status).toBe('tripwire')
    expect(outcome.chainValid).toBe(true)
    const approved = outcome.postRecords.find((r) => r.payload.span === 'tool.execute.approved')
    expect(approved).toBeUndefined()
    const oversight = outcome.postRecords.find((r) => r.payload.span === 'oversight.decision')
    expect(oversight?.payload.attrs['fuze.oversight.action']).toBe('reject')
  })

  it('override: tool runs with substituted args after restart, chain remains valid', async () => {
    const artifacts = await runUntilSuspend(tmpDir)
    const outcome = await resumeFromDisk(artifacts, {
      action: 'override',
      rationale: 'reduce amount',
      overseerId: 'overseer-3',
      overrideArgs: { amount: 50 },
    })
    expect(outcome.status).toBe('completed')
    expect(outcome.chainValid).toBe(true)
    const approved = outcome.postRecords.find((r) => r.payload.span === 'tool.execute.approved')
    expect(approved).toBeDefined()
  })

  it('final chain head is deterministic across two independent restarts with the same continuation', async () => {
    const dirA = mkdtempSync(join(tmpdir(), 'fuze-durability-detA-'))
    const dirB = mkdtempSync(join(tmpdir(), 'fuze-durability-detB-'))
    try {
      const artA = await runUntilSuspend(dirA)
      const artB = await runUntilSuspend(dirB)
      const outA = await resumeFromDisk(artA, {
        action: 'approve',
        rationale: 'r',
        overseerId: 'o',
      })
      const outB = await resumeFromDisk(artB, {
        action: 'approve',
        rationale: 'r',
        overseerId: 'o',
      })
      expect(outA.postRecords.length).toBe(outB.postRecords.length)
      const summarize = (rs: readonly ChainedRecord<EvidenceSpan>[]): string =>
        rs.map((r) => r.payload.span).join('|')
      expect(summarize(outA.postRecords)).toBe(summarize(outB.postRecords))
    } finally {
      rmSync(dirA, { recursive: true, force: true })
      rmSync(dirB, { recursive: true, force: true })
    }
  })
})
