/**
 * dispatch-builder — synthesize typed dispatch_<role> tools from a parent's
 * canDispatch list.
 *
 * For each role the parent can dispatch to, generate a tool whose:
 *   - name is `dispatch_<role.name>`
 *   - input schema accepts { task, view?, forwardContext?, forward? }
 *   - output is the role's outputSchema (intersected with the selected view if any)
 *
 * The handler is a placeholder that throws until wired to the loop integration.
 * The contract — name, input shape, output type, hash references — is what
 * matters for this sprint.
 */

import { z, type ZodType } from 'zod'
import { createHash } from 'node:crypto'
import { canonicalize } from '../evidence/canonical.js'
import type { AnyAgentRole } from '../types/role.js'

export interface SynthesizedDispatchTool {
  readonly name: string
  readonly description: string
  readonly roleName: string
  readonly roleHash: string
  readonly inputSchema: ZodType<unknown>
  readonly outputSchema: ZodType<unknown>
  readonly availableViews: readonly string[]
}

const sha256 = (s: string): string =>
  createHash('sha256').update(s).digest('hex')

const buildInputSchema = (role: AnyAgentRole): ZodType<unknown> => {
  const viewNames = Object.keys(role.outputViews)
  const viewSchema =
    viewNames.length > 0
      ? z.enum([viewNames[0]!, ...viewNames.slice(1)] as [string, ...string[]]).optional()
      : z.undefined().optional()
  return z.object({
    task: z.string().min(10, 'task must be at least 10 characters and self-contained'),
    view: viewSchema,
    forwardContext: z.array(z.string()).optional(),
    forward: z.array(z.enum(['principal', 'tenant', 'subjectRef'])).optional(),
  })
}

const buildOutputSchema = (role: AnyAgentRole): ZodType<unknown> => {
  const viewNames = Object.keys(role.outputViews)
  if (viewNames.length === 0) return role.outputSchema
  // Output is base & (selected view | empty) — represented as a passthrough
  // that the runtime narrows once the view selection is known. For type-system
  // convenience we treat it as base; runtime asserts the selected view shape.
  return role.outputSchema
}

export const synthesizeDispatchTool = (role: AnyAgentRole): SynthesizedDispatchTool => {
  const description = `Dispatch a sub-task to the "${role.name}" capability envelope. ` +
    `The child runs in isolation with its own role-level instructions and tools. ` +
    `Provide a self-contained task brief; the child cannot see this conversation. ` +
    (Object.keys(role.outputViews).length > 0
      ? `Optional output views: ${Object.keys(role.outputViews).join(', ')}.`
      : `Returns the role's base output shape.`)
  return {
    name: `dispatch_${role.name.replace(/[^a-zA-Z0-9_]/g, '_')}`,
    description,
    roleName: role.name,
    roleHash: role.roleHash,
    inputSchema: buildInputSchema(role),
    outputSchema: buildOutputSchema(role),
    availableViews: Object.keys(role.outputViews),
  }
}

export const synthesizeDispatchTools = (
  roles: readonly AnyAgentRole[],
): readonly SynthesizedDispatchTool[] => roles.map(synthesizeDispatchTool)

/**
 * Computes the dispatchManifestHash a parent's evidence carries at run start.
 * This binds the parent run to the exact set + version of children it could
 * have dispatched to. Auditors verify children evidence references against
 * this manifest.
 */
export const dispatchManifestHash = (roles: readonly AnyAgentRole[]): string => {
  const manifest = canonicalize({
    roles: roles
      .map((r) => ({ name: r.name, roleHash: r.roleHash }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  })
  return sha256(manifest)
}
