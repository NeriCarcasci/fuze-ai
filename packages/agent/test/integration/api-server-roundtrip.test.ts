import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { z } from 'zod'

import {
  createFuzeAgentApiServer,
  InMemorySpansStore,
  BearerAuth,
} from '@fuze-ai/agent-api-server'
import { SqliteSuspendStore } from '@fuze-ai/agent-suspend-store'
import { ApiClient } from '@fuze-ai/agent-cli'
import { PATHS } from '@fuze-ai/agent-api'
import { LocalKeySigner } from '@fuze-ai/agent-signing'
import type { Hono } from 'hono'

import { defineAgent } from '../../src/agent/define-agent.js'
import { defineTool } from '../../src/agent/define-tool.js'
import { inMemorySecrets } from '../../src/agent/secrets-noop.js'
import { runAgent } from '../../src/loop/loop.js'
import { StaticPolicyEngine } from '../../src/policy/static.js'
import { verifyChain } from '../../src/evidence/hash-chain.js'
import type { ChainedRecord } from '../../src/evidence/hash-chain.js'
import type { EvidenceSpan } from '../../src/evidence/emitter.js'
import type { FuzeModel, ModelStep } from '../../src/types/model.js'
import type {
  ThreatBoundary,
  RetentionPolicy,
  SubjectRef,
} from '../../src/types/compliance.js'
import { Ok } from '../../src/types/result.js'
import { makeTenantId, makePrincipalId } from '../../src/types/brand.js'
import type { OversightDecision, SuspendedRun } from '../../src/types/oversight.js'

const TB: ThreatBoundary = {
  trustedCallers: ['agent-loop'],
  observesSecrets: false,
  egressDomains: 'none',
  readsFilesystem: false,
  writesFilesystem: false,
}
const RET: RetentionPolicy = {
  id: 'integration.api-roundtrip.v1',
  hashTtlDays: 30,
  fullContentTtlDays: 7,
  decisionTtlDays: 90,
}

const SUBJECT: SubjectRef = { hmac: 'subj-hmac-1', scheme: 'hmac-sha256' }

const echoTool = defineTool.public({
  name: 'echo',
  description: 'echoes',
  input: z.object({ text: z.string() }),
  output: z.object({ text: z.string() }),
  threatBoundary: TB,
  retention: RET,
  run: async (input) => Ok({ text: input.text }),
})

const denyTool = defineTool.public({
  name: 'forbidden',
  description: 'always denied',
  input: z.object({}),
  output: z.object({}),
  threatBoundary: TB,
  retention: RET,
  run: async () => Ok({}),
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

const startHttpServer = async (
  app: Hono,
): Promise<{ url: string; close: () => Promise<void> }> => {
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const body = chunks.length === 0 ? undefined : Buffer.concat(chunks)
    const url = `http://localhost${req.url ?? '/'}`
    const headers = new Headers()
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers.set(k, v)
      else if (Array.isArray(v)) headers.set(k, v.join(','))
    }
    const init: RequestInit = {
      method: req.method,
      headers,
      ...(body && req.method !== 'GET' && req.method !== 'HEAD' ? { body: new Uint8Array(body) } : {}),
    }
    const response = await app.fetch(new Request(url, init))
    res.statusCode = response.status
    response.headers.forEach((value, key) => res.setHeader(key, value))
    const buf = Buffer.from(await response.arrayBuffer())
    res.end(buf)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  if (!addr || typeof addr === 'string') throw new Error('no listen address')
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  }
}

describe('integration: agent-api-server + ApiClient roundtrip', () => {
  let suspendStore: SqliteSuspendStore
  let spansStore: InMemorySpansStore
  let app: Hono
  let httpServer: { url: string; close: () => Promise<void> }
  let workDir: string
  let signer: LocalKeySigner

  beforeEach(async () => {
    workDir = mkdtempSync(path.join(os.tmpdir(), 'fuze-api-rt-'))
    signer = new LocalKeySigner({ keyPath: path.join(workDir, 'agent-key') })
    suspendStore = new SqliteSuspendStore({ databasePath: ':memory:' })
    spansStore = new InMemorySpansStore()
    const auth = new BearerAuth(
      new Map([['key-1', { tenantId: 't-1', principalId: 'p-1' }]]),
    )
    app = createFuzeAgentApiServer({
      suspendStore,
      spansStore,
      auth,
      maxLongPollMs: 2000,
    })
    httpServer = await startHttpServer(app)
  })

  afterEach(async () => {
    await httpServer.close()
    suspendStore.close()
    rmSync(workDir, { recursive: true, force: true })
  })

  it('happy path: in-process agent run → POST /v1/spans → GET /v1/runs/:id/verify reports chainValid=true and matching span count', async () => {
    const records: ChainedRecord<EvidenceSpan>[] = []
    const agent = defineAgent({
      purpose: 'roundtrip-happy',
      lawfulBasis: 'consent',
      annexIIIDomain: 'none',
      producesArt22Decision: false,
      model: fakeModel([
        {
          content: '',
          toolCalls: [{ id: 't1', name: 'echo', args: { text: 'hi' } }],
          finishReason: 'tool_calls',
          tokensIn: 1,
          tokensOut: 1,
        },
        {
          content: '{"final":"hi"}',
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
    const result = await runAgent(
      {
        definition: agent,
        policy: new StaticPolicyEngine([
          { id: 'allow.echo', toolName: 'echo', effect: 'allow' },
        ]),
        evidenceSink: (r) => records.push(r),
      },
      {
        tenant: makeTenantId('t-1'),
        principal: makePrincipalId('p-1'),
        subjectRef: SUBJECT,
        secrets: inMemorySecrets({}),
        userMessage: 'go',
      },
    )
    expect(result.status).toBe('completed')
    expect(verifyChain(records)).toBe(true)

    const post = await fetch(`${httpServer.url}${PATHS.spans}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer key-1' },
      body: JSON.stringify({ spans: records }),
    })
    expect(post.status).toBe(201)
    const postBody = (await post.json()) as { accepted: number }
    expect(postBody.accepted).toBe(records.length)

    const client = new ApiClient({
      baseUrl: httpServer.url,
      apiKey: 'key-1',
      maxRetries: 0,
    })
    const verify = await client.runVerify(result.runId)
    expect(verify.chainValid).toBe(true)

    const verifyRaw = await fetch(`${httpServer.url}${PATHS.runVerify(result.runId)}`, {
      headers: { authorization: 'Bearer key-1' },
    })
    const verifyBody = (await verifyRaw.json()) as { spanCount: number; chainValid: boolean }
    expect(verifyBody.spanCount).toBe(records.length)
  })

  it('auth failure: GET /v1/runs/:id/verify without bearer returns 401', async () => {
    const res = await fetch(`${httpServer.url}${PATHS.runVerify('nope')}`)
    expect(res.status).toBe(401)
  })

  it('subject filter: spans with one subjectRef are visible only via that subject', async () => {
    const records: ChainedRecord<EvidenceSpan>[] = []
    const agent = defineAgent({
      purpose: 'roundtrip-subject',
      lawfulBasis: 'consent',
      annexIIIDomain: 'none',
      producesArt22Decision: false,
      model: fakeModel([
        {
          content: '{"final":"x"}',
          toolCalls: [],
          finishReason: 'stop',
          tokensIn: 1,
          tokensOut: 1,
        },
      ]),
      tools: [echoTool],
      output: z.object({ final: z.string() }),
      maxSteps: 1,
      retryBudget: 0,
      deps: {},
    })
    const result = await runAgent(
      {
        definition: agent,
        policy: new StaticPolicyEngine([]),
        evidenceSink: (r) => records.push(r),
      },
      {
        tenant: makeTenantId('t-1'),
        principal: makePrincipalId('p-1'),
        subjectRef: SUBJECT,
        secrets: inMemorySecrets({}),
        userMessage: 'go',
      },
    )
    expect(result.status).toBe('completed')

    await fetch(`${httpServer.url}${PATHS.spans}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer key-1' },
      body: JSON.stringify({ spans: records }),
    })

    const correct = await fetch(`${httpServer.url}${PATHS.subjectSpans(SUBJECT.hmac)}`, {
      headers: { authorization: 'Bearer key-1' },
    })
    const correctBody = (await correct.json()) as { spans: unknown[] }
    expect(correctBody.spans.length).toBeGreaterThan(0)

    const wrong = await fetch(`${httpServer.url}${PATHS.subjectSpans('other-hmac')}`, {
      headers: { authorization: 'Bearer key-1' },
    })
    const wrongBody = (await wrong.json()) as { spans: unknown[] }
    expect(wrongBody.spans.length).toBe(0)
  })

  it('long-poll roundtrip: suspended run + decision returns 200 within window', async () => {
    const runId = 'run-longpoll-1'
    const suspended: SuspendedRun = {
      runId: runId as never,
      suspendedAtSpanId: 'step-1' as never,
      suspendedAtSequence: 1,
      chainHeadAtSuspend: 'a'.repeat(64),
      toolName: 'echo',
      toolArgs: { text: 'hi' },
      reason: 'awaiting',
      resumeToken: {
        runId: runId as never,
        suspendedAtSequence: 1,
        chainHeadAtSuspend: 'a'.repeat(64),
        nonce: 'n-1',
        signature: 'sig',
        publicKeyId: signer.publicKeyId,
      },
      definitionFingerprint: 'fp-1',
    }
    const post = await fetch(`${httpServer.url}${PATHS.suspendedRuns}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer key-1' },
      body: JSON.stringify({ suspendedRun: suspended }),
    })
    expect(post.status).toBe(201)

    const decision: OversightDecision = {
      action: 'approve',
      rationale: 'ok',
      overseerId: 'overseer-1',
    }

    const pollPromise = fetch(`${httpServer.url}${PATHS.runDecisions(runId)}?wait=2`, {
      headers: { authorization: 'Bearer key-1' },
    })

    setTimeout(() => {
      void fetch(`${httpServer.url}${PATHS.suspendedRunDecisions(runId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer key-1' },
        body: JSON.stringify({ decision }),
      })
    }, 50)

    const polled = await pollPromise
    expect(polled.status).toBe(200)
    const polledBody = (await polled.json()) as { decision: OversightDecision }
    expect(polledBody.decision.action).toBe('approve')
  })
})
