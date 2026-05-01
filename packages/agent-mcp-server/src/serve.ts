import { randomUUID } from 'node:crypto'
import type { ZodType } from 'zod'
import {
  EvidenceEmitter,
  type AnyFuzeTool,
  type ChainedRecord,
  type Ctx,
  type EvidenceSpan,
  type FuzeTool,
  type PolicyEngine,
  type SecretsHandle,
  type SubjectRef,
  buildCtx,
  inMemorySecrets,
  isRetryable,
  makePrincipalId,
  makeRunId,
  makeStepId,
  makeTenantId,
} from '@fuze-ai/agent'
import {
  JSON_RPC_ERR,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type McpServerTransport,
} from './types.js'
import { zodToJsonSchema, type JsonSchema } from './zod-to-json-schema.js'

export interface ServeFuzeAgentOptions {
  readonly tools: readonly FuzeTool<unknown, unknown, unknown>[]
  readonly policy: PolicyEngine
  readonly transport: McpServerTransport
  readonly evidenceSink: (record: ChainedRecord<EvidenceSpan>) => void | Promise<void>
  readonly serverInfo: { readonly name: string; readonly version: string }
  readonly allowSpecialCategory?: boolean
  readonly defaultTenant?: string
  readonly defaultPrincipal?: string
  readonly secrets?: SecretsHandle
  readonly clock?: () => Date
}

export interface ServeFuzeAgentHandle {
  stop(): Promise<void>
}

interface McpToolDescriptor {
  readonly name: string
  readonly description: string
  readonly inputSchema: JsonSchema
}

const errorResponse = (
  id: JsonRpcRequest['id'],
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  error: data === undefined ? { code, message } : { code, message, data },
})

const okResponse = (id: JsonRpcRequest['id'], result: unknown): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  result,
})

const isSpecialCategory = (t: AnyFuzeTool): boolean => t.dataClassification === 'special-category'

const buildToolList = (
  tools: readonly AnyFuzeTool[],
  allowSpecialCategory: boolean,
): readonly McpToolDescriptor[] => {
  const visible = allowSpecialCategory ? tools : tools.filter((t) => !isSpecialCategory(t))
  return visible.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: zodToJsonSchema(t.input as ZodType<unknown>),
  }))
}

const extractMeta = (
  params: Readonly<Record<string, unknown>> | undefined,
): { tenant?: string; principal?: string; subjectHmac?: string } => {
  const meta = (params?.['_meta'] ?? params?.['meta']) as Record<string, unknown> | undefined
  if (!meta || typeof meta !== 'object') return {}
  const out: { tenant?: string; principal?: string; subjectHmac?: string } = {}
  if (typeof meta['tenant'] === 'string') out.tenant = meta['tenant']
  if (typeof meta['principal'] === 'string') out.principal = meta['principal']
  if (typeof meta['subjectHmac'] === 'string') out.subjectHmac = meta['subjectHmac']
  return out
}

export const serveFuzeAgent = (opts: ServeFuzeAgentOptions): ServeFuzeAgentHandle => {
  const allowSpecialCategory = opts.allowSpecialCategory === true
  const defaultTenant = opts.defaultTenant ?? 'mcp-default-tenant'
  const defaultPrincipal = opts.defaultPrincipal ?? 'mcp-default-principal'
  const secrets = opts.secrets ?? inMemorySecrets({})
  const clock = opts.clock ?? (() => new Date())

  const toolsByName = new Map<string, AnyFuzeTool>()
  for (const t of opts.tools) toolsByName.set(t.name, t)

  const handler = async (req: JsonRpcRequest): Promise<JsonRpcResponse> => {
    if (req.jsonrpc !== '2.0') {
      return errorResponse(req.id, JSON_RPC_ERR.InvalidRequest, 'jsonrpc must be "2.0"')
    }

    if (req.method === 'initialize') {
      return okResponse(req.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: opts.serverInfo,
      })
    }

    if (req.method === 'tools/list') {
      return okResponse(req.id, {
        tools: buildToolList(opts.tools, allowSpecialCategory),
      })
    }

    if (req.method === 'tools/call') {
      return handleToolsCall(req)
    }

    return errorResponse(req.id, JSON_RPC_ERR.MethodNotFound, `unknown method: ${req.method}`)
  }

  const handleToolsCall = async (req: JsonRpcRequest): Promise<JsonRpcResponse> => {
    const params = req.params
    if (!params || typeof params['name'] !== 'string') {
      return errorResponse(req.id, JSON_RPC_ERR.InvalidParams, 'params.name (string) required')
    }
    const toolName = params['name']
    const args = (params['arguments'] ?? {}) as unknown

    const tool = toolsByName.get(toolName)
    if (!tool) {
      return errorResponse(req.id, JSON_RPC_ERR.MethodNotFound, `tool not found: ${toolName}`)
    }

    if (isSpecialCategory(tool) && !allowSpecialCategory) {
      return errorResponse(
        req.id,
        JSON_RPC_ERR.ToolRefused,
        `tool '${toolName}' refused: dataClassification=special-category requires allowSpecialCategory=true`,
      )
    }

    const meta = extractMeta(params)
    const tenantId = makeTenantId(meta.tenant ?? defaultTenant)
    const principalId = makePrincipalId(meta.principal ?? defaultPrincipal)
    const runId = makeRunId(randomUUID())
    const stepId = makeStepId(randomUUID())
    const subjectRef: SubjectRef | undefined = meta.subjectHmac
      ? { hmac: meta.subjectHmac, scheme: 'hmac-sha256' }
      : undefined

    const lawfulBasis =
      tool.dataClassification === 'public'
        ? 'legitimate-interests'
        : (tool.allowedLawfulBases?.[0] ?? 'legitimate-interests')

    const emitter = new EvidenceEmitter({
      tenant: tenantId,
      principal: principalId,
      runId,
      ...(subjectRef ? { subjectRef } : {}),
      lawfulBasis,
      annexIIIDomain: 'none',
      producesArt22Decision: false,
      retention: tool.retention,
      captureFullContent: false,
      sink: opts.evidenceSink,
    })

    const collected: Record<string, unknown> = {}
    const ctx: Ctx<unknown> = buildCtx<unknown>({
      tenant: tenantId,
      principal: principalId,
      runId,
      stepId,
      ...(subjectRef ? { subjectRef } : {}),
      deps: {} as unknown,
      secrets,
      attribute: (k, v) => {
        collected[k] = v
      },
      invoke: async () => {
        throw new Error('ctx.invoke is not available in MCP server context')
      },
    })

    const startedAt = clock().toISOString()

    let policyDecision
    try {
      policyDecision = await opts.policy.evaluate({ tool, args, ctx })
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      emitter.emit({
        span: 'mcp.tools/call',
        role: 'tool',
        stepId,
        startedAt,
        endedAt: clock().toISOString(),
        attrs: {
          'gen_ai.tool.name': tool.name,
          'fuze.data_classification': tool.dataClassification,
          'fuze.tool.outcome': 'denied',
          'fuze.policy.engine_error': true,
          'fuze.policy.reason': reason,
          'mcp.transport': 'json-rpc',
        },
      })
      return errorResponse(req.id, JSON_RPC_ERR.PolicyEngineError, `policy engine error (fail-stop): ${reason}`)
    }

    if (policyDecision.effect !== 'allow') {
      emitter.emit({
        span: 'mcp.tools/call',
        role: 'tool',
        stepId,
        startedAt,
        endedAt: clock().toISOString(),
        attrs: {
          'gen_ai.tool.name': tool.name,
          'fuze.data_classification': tool.dataClassification,
          'fuze.tool.outcome': 'denied',
          'fuze.policy.effect': policyDecision.effect,
          'fuze.policy.policy_id': policyDecision.policyId ?? 'unknown',
          'fuze.policy.reason': policyDecision.reason ?? '',
          'mcp.transport': 'json-rpc',
        },
      })
      return errorResponse(
        req.id,
        JSON_RPC_ERR.PolicyDenied,
        `policy ${policyDecision.effect}: ${policyDecision.reason ?? policyDecision.policyId ?? 'no reason'}`,
      )
    }

    let parsed: unknown
    try {
      parsed = (tool.input as ZodType<unknown>).parse(args)
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      emitter.emit({
        span: 'mcp.tools/call',
        role: 'tool',
        stepId,
        startedAt,
        endedAt: clock().toISOString(),
        attrs: {
          'gen_ai.tool.name': tool.name,
          'fuze.data_classification': tool.dataClassification,
          'fuze.tool.outcome': 'error',
          'fuze.tool.error_kind': 'input_validation',
          'mcp.transport': 'json-rpc',
        },
      })
      return errorResponse(req.id, JSON_RPC_ERR.InvalidParams, `input schema rejected args: ${reason}`)
    }

    const execStarted = clock().toISOString()
    let outcomeKind: 'value' | 'error' = 'error'
    let outputValue: unknown = undefined
    let errorReason = ''

    try {
      const result = await tool.run(parsed, ctx)
      if (result.ok) {
        try {
          outputValue = (tool.output as ZodType<unknown>).parse(result.value)
          outcomeKind = 'value'
        } catch (e) {
          errorReason = `tool output failed schema: ${(e as Error).message}`
        }
      } else if (isRetryable(result.error)) {
        errorReason = result.error.reason
      } else {
        const err = result.error
        errorReason = err instanceof Error ? err.message : String(err)
      }
    } catch (e) {
      errorReason = e instanceof Error ? e.message : String(e)
    }

    emitter.emit({
      span: 'mcp.tools/call',
      role: 'tool',
      stepId,
      startedAt: execStarted,
      endedAt: clock().toISOString(),
      attrs: {
        'gen_ai.tool.name': tool.name,
        'gen_ai.tool.type': 'function',
        'fuze.data_classification': tool.dataClassification,
        'fuze.tool.outcome': outcomeKind,
        'mcp.transport': 'json-rpc',
        ...collected,
      },
      content:
        outcomeKind === 'value'
          ? { input: parsed, output: outputValue }
          : { input: parsed, error: errorReason },
    })

    if (outcomeKind === 'error') {
      return errorResponse(req.id, JSON_RPC_ERR.ToolExecutionError, errorReason)
    }

    return okResponse(req.id, {
      content: [
        {
          type: 'text',
          text: typeof outputValue === 'string' ? outputValue : JSON.stringify(outputValue),
        },
      ],
      isError: false,
    })
  }

  void opts.transport.start(handler)

  return {
    stop: () => opts.transport.stop(),
  }
}
