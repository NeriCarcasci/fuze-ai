import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { DEFAULT_RETENTION, Ok, type AnyFuzeTool, type ThreatBoundary } from '@fuze-ai/agent'
import {
  AdmissionRefusedError,
  FingerprintMismatchError,
  InMemoryFingerprintStore,
  McpClientHost,
  type AdmissionContext,
  type ToolCallRecord,
} from '../src/index.js'
import { FakeMcpTransport, FakeMcpTransportFactory } from '../src/fake-transport.js'
import { unverifiedTool } from '../src/unverified.js'
import type { McpAdmission, McpSandboxTier } from '../src/types.js'

const tb: ThreatBoundary = {
  trustedCallers: ['mcp-host'],
  observesSecrets: false,
  egressDomains: 'none',
  readsFilesystem: false,
  writesFilesystem: false,
}

const buildAdmission = (overrides: Partial<McpAdmission> = {}): McpAdmission => ({
  serverId: overrides.serverId ?? 's1',
  allowedToolNames: overrides.allowedToolNames ?? ['echo'],
  maxDescriptionLength: overrides.maxDescriptionLength ?? 200,
  fingerprint: overrides.fingerprint ?? { algorithm: 'sha256', digest: 'fp-1' },
  sandboxTier: (overrides.sandboxTier ?? 'vm-managed') as McpSandboxTier,
})

const buildFuzeTool = (name: string, description = 'd'): AnyFuzeTool =>
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

const makeFactory = (
  toolsByServer: Record<string, ReadonlyArray<{ name: string; description: string }>>,
): FakeMcpTransportFactory =>
  new FakeMcpTransportFactory((admission, transport) => {
    const tools = toolsByServer[admission.serverId] ?? []
    transport.setMethodResponse('tools/list', { tools })
  })

describe('McpClientHost', () => {
  it('addServer accepts an admission and lists discovered tools', async () => {
    const factory = makeFactory({
      s1: [{ name: 'echo', description: 'echo tool' }],
    })
    const host = new McpClientHost({
      admissions: [],
      transportFactory: factory,
      toolBuilder: async (ctx: AdmissionContext) =>
        ctx.discovered.map((d) => buildFuzeTool(d.name, d.description)),
    })
    await host.addServer(buildAdmission())
    const tools = host.listTools()
    expect(tools.map((t) => t.name)).toEqual(['echo'])
    await host.dispose()
  })

  it('records every tools/call request and response via onCall', async () => {
    const factory = makeFactory({
      s1: [{ name: 'echo', description: 'echo tool' }],
    })
    const records: ToolCallRecord[] = []
    const host = new McpClientHost({
      admissions: [],
      transportFactory: factory,
      onCall: (rec) => records.push(rec),
      toolBuilder: async (ctx: AdmissionContext) => {
        const transport = ctx.transport
        const created = factory.created[factory.created.length - 1]!
        created.setResponse('tools/call', { name: 'echo', arguments: { msg: 'hi' } }, {
          content: [{ type: 'text', text: 'echoed: hi' }],
        })
        await transport.request('tools/call', { name: 'echo', arguments: { msg: 'hi' } })
        return ctx.discovered.map((d) => buildFuzeTool(d.name, d.description))
      },
    })
    await host.addServer(buildAdmission())
    expect(records).toHaveLength(1)
    expect(records[0]?.method).toBe('tools/call')
    expect(records[0]?.serverId).toBe('s1')
    expect(records[0]?.response).toEqual({
      content: [{ type: 'text', text: 'echoed: hi' }],
    })
    expect(records[0]?.durationMs).toBeGreaterThanOrEqual(0)
    await host.dispose()
  })

  it('does not record non-tools/call methods (e.g. tools/list)', async () => {
    const factory = makeFactory({
      s1: [{ name: 'echo', description: 'echo tool' }],
    })
    const records: ToolCallRecord[] = []
    const host = new McpClientHost({
      admissions: [],
      transportFactory: factory,
      onCall: (rec) => records.push(rec),
      toolBuilder: async () => [],
    })
    await host.addServer(buildAdmission())
    expect(records).toHaveLength(0)
    await host.dispose()
  })

  it('throws FingerprintMismatchError when an admission rotates the fingerprint', async () => {
    const factory = makeFactory({ s1: [] })
    const store = new InMemoryFingerprintStore()
    const host1 = new McpClientHost({
      admissions: [],
      transportFactory: factory,
      fingerprintStore: store,
      toolBuilder: async () => [],
    })
    await host1.addServer(buildAdmission({ fingerprint: { algorithm: 'sha256', digest: 'fp-A' } }))
    await host1.dispose()

    const host2 = new McpClientHost({
      admissions: [],
      transportFactory: factory,
      fingerprintStore: store,
      toolBuilder: async () => [],
    })
    await expect(
      host2.addServer(buildAdmission({ fingerprint: { algorithm: 'sha256', digest: 'fp-B' } })),
    ).rejects.toBeInstanceOf(FingerprintMismatchError)
    await host2.dispose()
  })

  it('dispose() closes all transports', async () => {
    const factory = makeFactory({ s1: [], s2: [] })
    const host = new McpClientHost({
      admissions: [],
      transportFactory: factory,
      toolBuilder: async () => [],
    })
    await host.addServer(buildAdmission({ serverId: 's1', allowedToolNames: [] }))
    await host.addServer(
      buildAdmission({
        serverId: 's2',
        allowedToolNames: [],
        fingerprint: { algorithm: 'sha256', digest: 'fp-2' },
      }),
    )
    expect(factory.created).toHaveLength(2)
    await host.dispose()
    for (const t of factory.created) {
      expect((t as FakeMcpTransport).isClosed()).toBe(true)
    }
  })

  it('isolates tools per server', async () => {
    const factory = makeFactory({
      s1: [{ name: 'a', description: 'a' }],
      s2: [{ name: 'b', description: 'b' }],
    })
    const host = new McpClientHost({
      admissions: [],
      transportFactory: factory,
      toolBuilder: async (ctx) =>
        ctx.discovered.map((d) => buildFuzeTool(d.name, d.description)),
    })
    await host.addServer(buildAdmission({ serverId: 's1', allowedToolNames: ['a'] }))
    await host.addServer(
      buildAdmission({
        serverId: 's2',
        allowedToolNames: ['b'],
        fingerprint: { algorithm: 'sha256', digest: 'fp-2' },
      }),
    )
    const names = host.listTools().map((t) => t.name).sort()
    expect(names).toEqual(['a', 'b'])
    await host.dispose()
  })

  it('forwards records to the injected onCall callback (vi.fn)', async () => {
    const factory = makeFactory({
      s1: [{ name: 'echo', description: 'echo' }],
    })
    const onCall = vi.fn()
    const host = new McpClientHost({
      admissions: [],
      transportFactory: factory,
      onCall,
      toolBuilder: async (ctx) => {
        const created = factory.created[factory.created.length - 1]!
        created.setResponse('tools/call', { name: 'echo' }, { ok: true })
        await ctx.transport.request('tools/call', { name: 'echo' })
        return []
      },
    })
    await host.addServer(buildAdmission())
    expect(onCall).toHaveBeenCalledTimes(1)
    const arg = onCall.mock.calls[0]?.[0] as ToolCallRecord
    expect(arg.serverId).toBe('s1')
    expect(arg.method).toBe('tools/call')
    await host.dispose()
  })

  it('refuses admission with sandboxTier in-process', async () => {
    const factory = makeFactory({ s1: [] })
    const host = new McpClientHost({
      admissions: [],
      transportFactory: factory,
      toolBuilder: async () => [],
    })
    await expect(
      host.addServer(buildAdmission({ sandboxTier: 'in-process' })),
    ).rejects.toBeInstanceOf(AdmissionRefusedError)
    await host.dispose()
  })

  it('drops discovered tools whose names are not in the admission allowlist', async () => {
    const factory = makeFactory({
      s1: [
        { name: 'allowed', description: 'a' },
        { name: 'forbidden', description: 'b' },
      ],
    })
    const host = new McpClientHost({
      admissions: [],
      transportFactory: factory,
      toolBuilder: async (ctx) =>
        ctx.discovered.map((d) => buildFuzeTool(d.name, d.description)),
    })
    await host.addServer(buildAdmission({ allowedToolNames: ['allowed'] }))
    expect(host.listTools().map((t) => t.name)).toEqual(['allowed'])
    await host.dispose()
  })

  it('records error responses with an error message', async () => {
    const factory = makeFactory({
      s1: [{ name: 'broken', description: 'b' }],
    })
    const records: ToolCallRecord[] = []
    const host = new McpClientHost({
      admissions: [],
      transportFactory: factory,
      onCall: (rec) => records.push(rec),
      toolBuilder: async (ctx) => {
        const created = factory.created[factory.created.length - 1]!
        created.setResponse('tools/call', { name: 'broken' }, undefined)
        await expect(ctx.transport.request('tools/call', { name: 'broken' })).rejects.toThrow()
        return []
      },
    })
    await host.addServer(buildAdmission({ allowedToolNames: ['broken'] }))
    expect(records).toHaveLength(1)
    expect(records[0]?.error?.message).toMatch(/no response set/)
    await host.dispose()
  })
})
