/**
 * buildDispatchTools — synthesize one PublicTool per role in the parent's
 * canDispatch list. Each tool routes to a runChild callback that the loop
 * provides; the callback creates a fresh evidence sub-chain rooted at the
 * parent's chain head and returns a DispatchResult.
 *
 * Compliance enforcement happens here, before runChild is called:
 *   - requiresTenant + parent has no tenant -> fail closed
 *   - requiresPrincipal + parent has no principal -> fail closed
 *   - forwardContext referencing files whose data classification exceeds
 *     the role's ceiling -> fail closed (caller-side check; runtime
 *     check on actual file class is the loop's responsibility)
 */

import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { PublicTool } from '../types/tool.js'
import { Ok, Err } from '../types/result.js'
import { DEFAULT_RETENTION } from '../types/compliance.js'
import { canonicalize } from '../evidence/canonical.js'
import type { AnyAgentRole } from '../types/role.js'
import type { DispatchResult, AgentRunFailure } from '../types/dispatch.js'
import type { TenantId, PrincipalId, RunId } from '../types/brand.js'
import type { SubjectRef } from '../types/compliance.js'

const DISPATCH_BOUNDARY = {
  trustedCallers: ['agent-loop'] as const,
  observesSecrets: false,
  egressDomains: 'none' as const,
  readsFilesystem: false,
  writesFilesystem: false,
}

export interface DispatchContext {
  readonly tenant?: TenantId
  readonly principal?: PrincipalId
  readonly subjectRef?: SubjectRef
  readonly parentRunId: RunId
  readonly parentChainHead: string
}

export interface RunChildInput {
  readonly role: AnyAgentRole
  readonly task: string
  readonly view?: string
  readonly forwardContext?: readonly string[]
  readonly forward: {
    readonly tenant?: TenantId
    readonly principal?: PrincipalId
    readonly subjectRef?: SubjectRef
  }
  readonly parentRunId: RunId
  readonly parentChainHead: string
}

export type RunChildCallback = (input: RunChildInput) => Promise<DispatchResult<unknown>>

const sha256 = (s: string): string =>
  createHash('sha256').update(s).digest('hex')

const buildInputSchema = (role: AnyAgentRole) => {
  const viewNames = Object.keys(role.outputViews)
  const viewSchema =
    viewNames.length > 0
      ? z.enum([viewNames[0]!, ...viewNames.slice(1)] as [string, ...string[]]).optional()
      : z.undefined().optional()
  return z.object({
    task: z.string().min(10, 'task must be at least 10 characters and self-contained'),
    view: viewSchema,
    forward_context: z.array(z.string()).optional(),
    forward: z.array(z.enum(['principal', 'tenant', 'subjectRef'])).optional(),
  })
}

export interface BuildDispatchToolsDeps {
  readonly roles: readonly AnyAgentRole[]
  readonly runChild: RunChildCallback
  readonly contextProvider: () => DispatchContext
}

const dispatchOutputSchema = z.object({
  ok: z.boolean(),
  output: z.unknown().optional(),
  failure: z
    .object({
      category: z.string(),
      message: z.string(),
      attribution: z.record(z.string(), z.unknown()),
      retriable: z.boolean(),
      attempt: z.number(),
    })
    .optional(),
  run_id: z.string(),
  chain_root: z.string(),
})

const failureToDict = (f: AgentRunFailure): Record<string, unknown> => ({
  category: f.category,
  message: f.message,
  attribution: f.attribution as unknown as Record<string, unknown>,
  retriable: f.retriable,
  attempt: f.attempt,
  ...(f.detailHash !== undefined ? { detail_hash: f.detailHash } : {}),
  ...(f.childFailure !== undefined ? { child_failure: failureToDict(f.childFailure) } : {}),
})

export const buildDispatchTools = (
  deps: BuildDispatchToolsDeps,
): readonly PublicTool<unknown, unknown>[] =>
  deps.roles.map((role) => buildOneDispatchTool(role, deps.runChild, deps.contextProvider))

const failClosed = (
  role: AnyAgentRole,
  category: 'policy_denied' | 'tool_input_invalid',
  message: string,
  parentRunId: RunId,
  parentChainHead: string,
): { ok: false; failure: AgentRunFailure; run_id: string; chain_root: string } => ({
  ok: false,
  failure: {
    category,
    message,
    attribution: { roleId: role.name },
    retriable: false,
    attempt: 0,
  },
  run_id: parentRunId,
  chain_root: parentChainHead,
})

const buildOneDispatchTool = (
  role: AnyAgentRole,
  runChild: RunChildCallback,
  contextProvider: () => DispatchContext,
): PublicTool<unknown, unknown> => {
  const inputSchema = buildInputSchema(role)
  const viewNames = Object.keys(role.outputViews)
  const description =
    `Dispatch a sub-task to the "${role.name}" capability envelope (role hash ${role.roleHash.slice(0, 12)}). ` +
    `The child runs in isolation with its own role-level instructions and tools. ` +
    `Provide a self-contained task brief; the child cannot see this conversation. ` +
    (viewNames.length > 0
      ? `Optional output views: ${viewNames.join(', ')}.`
      : `Returns the role's base output shape.`)

  return {
    name: `dispatch_${role.name.replace(/[^a-zA-Z0-9_]/g, '_')}`,
    description,
    input: inputSchema as unknown as z.ZodType<unknown>,
    output: dispatchOutputSchema as unknown as z.ZodType<unknown>,
    dataClassification: 'public',
    threatBoundary: DISPATCH_BOUNDARY,
    retention: DEFAULT_RETENTION,
    softCancelTimeoutMs: 60000,
    toolImplHash: sha256(canonicalize({ kind: 'fuze.dispatch', roleHash: role.roleHash })),
    toolVersion: '1.0.0',
    run: async (input) => {
      const parsed = input as z.infer<typeof inputSchema>
      const ctx = contextProvider()

      // Compliance enforcement — fail closed before invoking child.
      if (role.requiresTenant && !ctx.tenant) {
        return Ok(
          failClosed(
            role,
            'policy_denied',
            `role "${role.name}" requires tenant but parent context has none`,
            ctx.parentRunId,
            ctx.parentChainHead,
          ),
        )
      }
      if (role.requiresPrincipal && !ctx.principal) {
        return Ok(
          failClosed(
            role,
            'policy_denied',
            `role "${role.name}" requires principal but parent context has none`,
            ctx.parentRunId,
            ctx.parentChainHead,
          ),
        )
      }

      // Compute the forward set.
      const explicit = new Set(parsed.forward ?? [])
      const forward: RunChildInput['forward'] = {
        ...(role.requiresTenant && ctx.tenant ? { tenant: ctx.tenant } : {}),
        ...(role.requiresPrincipal && ctx.principal ? { principal: ctx.principal } : {}),
        ...(explicit.has('tenant') && ctx.tenant ? { tenant: ctx.tenant } : {}),
        ...(explicit.has('principal') && ctx.principal ? { principal: ctx.principal } : {}),
        ...(explicit.has('subjectRef') && ctx.subjectRef ? { subjectRef: ctx.subjectRef } : {}),
      }

      try {
        const result = await runChild({
          role,
          task: parsed.task,
          ...(parsed.view ? { view: parsed.view } : {}),
          ...(parsed.forward_context ? { forwardContext: parsed.forward_context } : {}),
          forward,
          parentRunId: ctx.parentRunId,
          parentChainHead: ctx.parentChainHead,
        })
        return Ok({
          ok: result.ok,
          ...(result.ok ? { output: result.output } : { failure: failureToDict(result.failure) }),
          run_id: result.runId,
          chain_root: result.chainRoot,
        })
      } catch (e) {
        return Err(e instanceof Error ? e : new Error(String(e)))
      }
    },
  }
}
