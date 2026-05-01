import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineTool, Ok } from '@fuze-ai/agent'
import type {
  ModelGenerateInput,
  RetentionPolicy,
  ThreatBoundary,
} from '@fuze-ai/agent'
import { mistralModel } from '../src/mistral.js'

// .env.local is a developer convenience: when CI_LIVE_MISTRAL is already set
// in the shell environment, we additionally pick up the API key from disk so
// you don't have to paste it on every invocation. It is NOT a way to opt
// into live tests by default — that gate is `process.env.CI_LIVE_MISTRAL`.
const loadEnvFromDotfile = (): void => {
  if (process.env['CI_LIVE_MISTRAL'] !== '1') return
  if (process.env['MISTRAL_API_KEY'] !== undefined) return
  try {
    const text = readFileSync('D:/Fuze-systems/fuze/.env.local', 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (trimmed === '' || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      const value = trimmed.slice(eq + 1).trim()
      if (key === 'MISTRAL_API_KEY' && process.env[key] === undefined) {
        process.env[key] = value
      }
    }
  } catch {
    /* file is optional; CI may inject env directly */
  }
}

loadEnvFromDotfile()

const TB: ThreatBoundary = {
  trustedCallers: ['agent-loop'],
  observesSecrets: false,
  egressDomains: 'none',
  readsFilesystem: false,
  writesFilesystem: false,
}

const RET: RetentionPolicy = {
  id: 'live.test.v1',
  hashTtlDays: 1,
  fullContentTtlDays: 1,
  decisionTtlDays: 1,
}

const echoTool = defineTool.public({
  name: 'echo',
  description: 'Echoes the supplied text verbatim.',
  input: z.object({ text: z.string() }),
  output: z.object({ text: z.string() }),
  threatBoundary: TB,
  retention: RET,
  run: async (input) => Ok({ text: input.text }),
})

const liveEnabled = process.env['CI_LIVE_MISTRAL'] === '1'

describe.skipIf(!liveEnabled)('mistralModel — live (gated by CI_LIVE_MISTRAL=1)', () => {
  it('completes a tiny prompt and reports tokens', async () => {
    const apiKey = process.env['MISTRAL_API_KEY']
    if (apiKey === undefined || apiKey.length === 0) {
      throw new Error('MISTRAL_API_KEY not set')
    }
    const model = mistralModel({ apiKey, model: 'mistral-small-latest' })
    expect(model.providerName).toBe('mistral')
    expect(model.residency).toBe('eu')

    const input: ModelGenerateInput = {
      messages: [{ role: 'user', content: 'reply with exactly: pong' }],
      tools: [],
    }
    const step = await model.generate(input)

    expect(step.content.length).toBeGreaterThan(0)
    expect(step.finishReason).toBe('stop')
    expect(step.tokensIn).toBeGreaterThan(0)
    expect(step.tokensOut).toBeGreaterThan(0)

    const redacted = {
      provider: model.providerName,
      residency: model.residency,
      tokensIn: step.tokensIn,
      tokensOut: step.tokensOut,
      finishReason: step.finishReason,
      contentLen: step.content.length,
    }
    console.log('mistral basic:', JSON.stringify(redacted))
  }, 30_000)

  it('returns at least one tool call when prompted to use a tool', async () => {
    const apiKey = process.env['MISTRAL_API_KEY']
    if (apiKey === undefined || apiKey.length === 0) {
      throw new Error('MISTRAL_API_KEY not set')
    }
    const model = mistralModel({ apiKey, model: 'mistral-small-latest' })
    const input: ModelGenerateInput = {
      messages: [{ role: 'user', content: 'echo the word fuze using the tool' }],
      tools: [echoTool],
    }
    const step = await model.generate(input)
    expect(step.toolCalls.length).toBeGreaterThan(0)
    expect(step.tokensIn).toBeGreaterThan(0)
    const redacted = {
      provider: model.providerName,
      residency: model.residency,
      tokensIn: step.tokensIn,
      tokensOut: step.tokensOut,
      toolCallCount: step.toolCalls.length,
      firstToolName: step.toolCalls[0]?.name,
    }
    console.log('mistral tool call:', JSON.stringify(redacted))
  }, 30_000)
})
