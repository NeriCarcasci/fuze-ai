import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineAgentRole } from '../src/agent/define-agent-role.js'
import {
  synthesizeDispatchTool,
  synthesizeDispatchTools,
  dispatchManifestHash,
} from '../src/agent/dispatch-builder.js'
import { defineTool } from '../src/agent/define-tool.js'
import { Ok } from '../src/types/result.js'
import { DEFAULT_RETENTION } from '../src/types/compliance.js'

const trustedBoundary = {
  trustedCallers: ['agent-loop'] as const,
  observesSecrets: false,
  egressDomains: 'none' as const,
  readsFilesystem: false,
  writesFilesystem: false,
}

const untrustedBoundary = {
  trustedCallers: ['agent-loop'] as const,
  observesSecrets: false,
  egressDomains: ['public.example.com'] as const,
  readsFilesystem: false,
  writesFilesystem: false,
}

const publicTool = defineTool.public({
  name: 'search_public_docs',
  description: 'search public docs',
  input: z.object({ query: z.string() }),
  output: z.object({ hits: z.array(z.string()) }),
  threatBoundary: untrustedBoundary,
  retention: DEFAULT_RETENTION,
  run: async () => Ok({ hits: [] }),
})

const personalTool = defineTool.personal({
  name: 'fetch_user_record',
  description: 'fetch a user record',
  input: z.object({ userId: z.string() }),
  output: z.object({ name: z.string() }),
  residencyRequired: 'eu',
  threatBoundary: trustedBoundary,
  allowedLawfulBases: ['contract'],
  retention: DEFAULT_RETENTION,
  run: async () => Ok({ name: 'redacted' }),
})

describe('defineAgentRole', () => {
  it('hashes a role deterministically', () => {
    const role = defineAgentRole({
      name: 'researcher',
      instructions: 'Answer with citations.',
      tools: [publicTool],
      dataClassification: 'public',
      outputSchema: z.object({ summary: z.string() }),
    })
    const role2 = defineAgentRole({
      name: 'researcher',
      instructions: 'Answer with citations.',
      tools: [publicTool],
      dataClassification: 'public',
      outputSchema: z.object({ summary: z.string() }),
    })
    expect(role.roleHash).toBe(role2.roleHash)
    expect(role.instructionsHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects tools that exceed the role data classification ceiling', () => {
    expect(() =>
      defineAgentRole({
        name: 'leaky-researcher',
        instructions: '...',
        tools: [personalTool],
        dataClassification: 'public',
        outputSchema: z.object({ summary: z.string() }),
      }),
    ).toThrow(/personal/)
  })

  it('requires residency declaration for personal data roles', () => {
    expect(() =>
      defineAgentRole({
        name: 'pdr',
        instructions: '...',
        tools: [personalTool],
        dataClassification: 'personal',
        outputSchema: z.object({ summary: z.string() }),
      }),
    ).toThrow(/residency/)
  })

  it('accepts personal data roles with residency declared', () => {
    const role = defineAgentRole({
      name: 'pdr',
      instructions: '...',
      tools: [personalTool],
      dataClassification: 'personal',
      residency: 'eu',
      lawfulBasis: 'contract',
      outputSchema: z.object({ summary: z.string() }),
    })
    expect(role.residency).toBe('eu')
  })
})

describe('synthesizeDispatchTool', () => {
  const role = defineAgentRole({
    name: 'researcher',
    instructions: '...',
    tools: [publicTool],
    dataClassification: 'public',
    outputSchema: z.object({ summary: z.string() }),
    outputViews: {
      citations: z.object({ sources: z.array(z.string()) }),
      table: z.object({ rows: z.array(z.record(z.string(), z.unknown())) }),
    },
  })

  it('synthesizes a typed dispatch tool', () => {
    const tool = synthesizeDispatchTool(role)
    expect(tool.name).toBe('dispatch_researcher')
    expect(tool.roleName).toBe('researcher')
    expect(tool.roleHash).toBe(role.roleHash)
    expect(tool.availableViews).toEqual(['citations', 'table'])
  })

  it('input schema requires task and accepts optional view enum', () => {
    const tool = synthesizeDispatchTool(role)
    const ok = tool.inputSchema.safeParse({ task: 'find me X policy details please' })
    expect(ok.success).toBe(true)
    const okView = tool.inputSchema.safeParse({
      task: 'find me X policy details please',
      view: 'citations',
    })
    expect(okView.success).toBe(true)
    const badView = tool.inputSchema.safeParse({
      task: 'find me X policy details please',
      view: 'nonexistent',
    })
    expect(badView.success).toBe(false)
    const tooShort = tool.inputSchema.safeParse({ task: 'short' })
    expect(tooShort.success).toBe(false)
  })

  it('synthesizes dispatch tools for a list of roles', () => {
    const role2 = defineAgentRole({
      name: 'computational',
      instructions: '...',
      tools: [],
      dataClassification: 'inherit-from-parent',
      outputSchema: z.object({ result: z.string() }),
    })
    const tools = synthesizeDispatchTools([role, role2])
    expect(tools.map((t) => t.name)).toEqual(['dispatch_researcher', 'dispatch_computational'])
  })

  it('dispatchManifestHash is deterministic and order-insensitive', () => {
    const role2 = defineAgentRole({
      name: 'computational',
      instructions: '...',
      tools: [],
      dataClassification: 'inherit-from-parent',
      outputSchema: z.object({ result: z.string() }),
    })
    const a = dispatchManifestHash([role, role2])
    const b = dispatchManifestHash([role2, role])
    expect(a).toBe(b)
  })
})
