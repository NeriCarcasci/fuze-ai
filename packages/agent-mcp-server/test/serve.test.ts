import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  Ok,
  StaticPolicyEngine,
  defineTool,
  type ChainedRecord,
  type EvidenceSpan,
  type FuzeTool,
  type RetentionPolicy,
  type ThreatBoundary,
} from '@fuze-ai/agent'
import { FakeMcpServerTransport } from '../src/fake-transport.js'
import { serveFuzeAgent } from '../src/serve.js'
import { JSON_RPC_ERR, type JsonRpcRequest } from '../src/types.js'

const TB: ThreatBoundary = {
  trustedCallers: ['mcp-host'],
  observesSecrets: false,
  egressDomains: 'none',
  readsFilesystem: false,
  writesFilesystem: false,
}

const RET: RetentionPolicy = {
  id: 'test.v1',
  hashTtlDays: 30,
  fullContentTtlDays: 7,
  decisionTtlDays: 90,
}

const echoTool = defineTool.public({
  name: 'echo',
  description: 'echoes input',
  input: z.object({ text: z.string() }),
  output: z.object({ text: z.string() }),
  threatBoundary: TB,
  retention: RET,
  run: async (input) => Ok({ text: input.text }),
})

const failingTool = defineTool.public({
  name: 'failing',
  description: 'always throws',
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
  threatBoundary: TB,
  retention: RET,
  run: async () => {
    throw new Error('boom')
  },
})

const sensitiveTool = defineTool.specialCategory({
  name: 'sensitive',
  description: 'special-category',
  input: z.object({ id: z.string() }),
  output: z.object({ id: z.string() }),
  threatBoundary: TB,
  retention: RET,
  allowedLawfulBases: ['consent'],
  art9Basis: 'explicit-consent',
  run: async (input) => Ok({ id: input.id }),
})

const allowAll = new StaticPolicyEngine([{ id: 'allow.all', toolName: '*', effect: 'allow' }])
const denyAll = new StaticPolicyEngine([{ id: 'deny.all', toolName: '*', effect: 'deny' }])

const req = (id: number, method: string, params?: Record<string, unknown>): JsonRpcRequest => ({
  jsonrpc: '2.0',
  id,
  method,
  ...(params ? { params } : {}),
})

const setup = (
  tools: readonly FuzeTool<unknown, unknown, unknown>[],
  opts: {
    policy?: typeof allowAll
    allowSpecialCategory?: boolean
  } = {},
) => {
  const transport = new FakeMcpServerTransport()
  const records: ChainedRecord<EvidenceSpan>[] = []
  const handle = serveFuzeAgent({
    tools,
    policy: opts.policy ?? allowAll,
    transport,
    evidenceSink: (r) => records.push(r),
    serverInfo: { name: 'fuze-test', version: '0.1.0' },
    ...(opts.allowSpecialCategory !== undefined ? { allowSpecialCategory: opts.allowSpecialCategory } : {}),
  })
  return { transport, records, handle }
}

describe('serveFuzeAgent', () => {
  it('tools/list returns the right shape with name/description/inputSchema', async () => {
    const { transport } = setup([echoTool])
    const res = await transport.sendRequest(req(1, 'tools/list'))
    expect(res.error).toBeUndefined()
    const result = res.result as { tools: { name: string; description: string; inputSchema: unknown }[] }
    expect(result.tools).toHaveLength(1)
    expect(result.tools[0]?.name).toBe('echo')
    expect(result.tools[0]?.description).toBe('echoes input')
    expect(result.tools[0]?.inputSchema).toMatchObject({
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    })
  })

  it('tools/call invokes the tool and returns its output', async () => {
    const { transport } = setup([echoTool])
    const res = await transport.sendRequest(
      req(2, 'tools/call', { name: 'echo', arguments: { text: 'hello' } }),
    )
    expect(res.error).toBeUndefined()
    const result = res.result as { content: { type: string; text: string }[]; isError: boolean }
    expect(result.isError).toBe(false)
    expect(result.content[0]?.text).toBe(JSON.stringify({ text: 'hello' }))
  })

  it('tools/call denied by Cerbos returns JSON-RPC PolicyDenied error', async () => {
    const { transport } = setup([echoTool], { policy: denyAll })
    const res = await transport.sendRequest(
      req(3, 'tools/call', { name: 'echo', arguments: { text: 'hi' } }),
    )
    expect(res.result).toBeUndefined()
    expect(res.error?.code).toBe(JSON_RPC_ERR.PolicyDenied)
  })

  it('tools/call with bad input returns JSON-RPC InvalidParams error', async () => {
    const { transport } = setup([echoTool])
    const res = await transport.sendRequest(
      req(4, 'tools/call', { name: 'echo', arguments: { text: 42 } }),
    )
    expect(res.result).toBeUndefined()
    expect(res.error?.code).toBe(JSON_RPC_ERR.InvalidParams)
  })

  it('special-category tool refused without allowSpecialCategory flag', async () => {
    const { transport } = setup([sensitiveTool])
    const list = await transport.sendRequest(req(5, 'tools/list'))
    const listResult = list.result as { tools: { name: string }[] }
    expect(listResult.tools).toHaveLength(0)

    const call = await transport.sendRequest(
      req(6, 'tools/call', { name: 'sensitive', arguments: { id: 'x' } }),
    )
    expect(call.error?.code).toBe(JSON_RPC_ERR.ToolRefused)
  })

  it('special-category tool allowed with allowSpecialCategory: true', async () => {
    const { transport } = setup([sensitiveTool], { allowSpecialCategory: true })
    const list = await transport.sendRequest(req(7, 'tools/list'))
    const listResult = list.result as { tools: { name: string }[] }
    expect(listResult.tools).toHaveLength(1)

    const call = await transport.sendRequest(
      req(8, 'tools/call', { name: 'sensitive', arguments: { id: 'x' } }),
    )
    expect(call.error).toBeUndefined()
    const callResult = call.result as { content: { text: string }[] }
    expect(callResult.content[0]?.text).toBe(JSON.stringify({ id: 'x' }))
  })

  it('emits an mcp.tools/call evidence span per call with role=tool', async () => {
    const { transport, records } = setup([echoTool])
    await transport.sendRequest(
      req(9, 'tools/call', { name: 'echo', arguments: { text: 'hello' } }),
    )
    const callSpans = records.filter((r) => r.payload.span === 'mcp.tools/call')
    expect(callSpans).toHaveLength(1)
    expect(callSpans[0]?.payload.role).toBe('tool')
    expect(callSpans[0]?.payload.attrs['gen_ai.tool.name']).toBe('echo')
    expect(callSpans[0]?.payload.attrs['fuze.tool.outcome']).toBe('value')
  })

  it('handles multiple sequential calls and chains evidence records', async () => {
    const { transport, records } = setup([echoTool])
    const r1 = await transport.sendRequest(
      req(10, 'tools/call', { name: 'echo', arguments: { text: 'one' } }),
    )
    const r2 = await transport.sendRequest(
      req(11, 'tools/call', { name: 'echo', arguments: { text: 'two' } }),
    )
    const r3 = await transport.sendRequest(
      req(12, 'tools/call', { name: 'echo', arguments: { text: 'three' } }),
    )
    expect(r1.error).toBeUndefined()
    expect(r2.error).toBeUndefined()
    expect(r3.error).toBeUndefined()
    expect(records.filter((r) => r.payload.span === 'mcp.tools/call')).toHaveLength(3)
  })

  it('tools/call on unknown tool returns MethodNotFound error', async () => {
    const { transport } = setup([echoTool])
    const res = await transport.sendRequest(
      req(13, 'tools/call', { name: 'nope', arguments: {} }),
    )
    expect(res.error?.code).toBe(JSON_RPC_ERR.MethodNotFound)
  })

  it('tool that throws returns ToolExecutionError and emits an error span', async () => {
    const { transport, records } = setup([failingTool])
    const res = await transport.sendRequest(
      req(14, 'tools/call', { name: 'failing', arguments: {} }),
    )
    expect(res.error?.code).toBe(JSON_RPC_ERR.ToolExecutionError)
    const span = records.find((r) => r.payload.span === 'mcp.tools/call')
    expect(span?.payload.attrs['fuze.tool.outcome']).toBe('error')
  })

  it('initialize returns serverInfo and capabilities', async () => {
    const { transport } = setup([echoTool])
    const res = await transport.sendRequest(req(15, 'initialize'))
    const result = res.result as { serverInfo: { name: string }; capabilities: { tools: unknown } }
    expect(result.serverInfo.name).toBe('fuze-test')
    expect(result.capabilities.tools).toBeDefined()
  })
})
