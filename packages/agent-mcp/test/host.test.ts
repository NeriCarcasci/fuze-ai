import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { DEFAULT_RETENTION, Ok, type AnyFuzeTool, type ThreatBoundary } from '@fuze-ai/agent'
import { StubMcpHost } from '../src/host.js'
import { unverifiedTool } from '../src/unverified.js'
import type { McpAdmission } from '../src/types.js'

const tb: ThreatBoundary = {
  trustedCallers: ['mcp-host'],
  observesSecrets: false,
  egressDomains: 'none',
  readsFilesystem: false,
  writesFilesystem: false,
}

const buildTool = (name: string, description = 'd'): AnyFuzeTool =>
  unverifiedTool({
    name,
    description,
    inputSchema: z.unknown(),
    metadata: {
      dataClassification: 'public',
      retention: DEFAULT_RETENTION,
      threatBoundary: tb,
    },
    invoke: async () => Ok(null),
  })

describe('StubMcpHost', () => {
  it('admits only allowed tool names and rejects oversized descriptions', async () => {
    const discovered: readonly AnyFuzeTool[] = [
      buildTool('alpha'),
      buildTool('beta'),
      buildTool('gamma', 'x'.repeat(500)),
    ]
    const host = new StubMcpHost({
      resolveTools: async () => discovered,
    })
    const admission: McpAdmission = {
      serverId: 's1',
      allowedToolNames: ['alpha', 'gamma'],
      maxDescriptionLength: 100,
      fingerprint: { algorithm: 'sha256', digest: 'abc' },
      sandboxTier: 'vm-managed',
    }
    await host.addServer(admission)
    const tools = host.listTools()
    expect(tools.map((t) => t.name)).toEqual(['alpha'])
    await host.dispose()
  })

  it('rejects duplicate server admissions', async () => {
    const host = new StubMcpHost({ resolveTools: async () => [] })
    const admission: McpAdmission = {
      serverId: 's1',
      allowedToolNames: [],
      maxDescriptionLength: 100,
      fingerprint: { algorithm: 'sha256', digest: 'abc' },
      sandboxTier: 'vm-managed',
    }
    await host.addServer(admission)
    await expect(host.addServer(admission)).rejects.toThrow(/already admitted/)
    await host.dispose()
  })
})
