/**
 * defineAgentRole — capability envelope.
 *
 * A role is a typed, hashed envelope a parent agent can dispatch into.
 * It carries its own tools, data classification ceiling, output schema,
 * and (optionally) output views for parent-selected return shapes.
 *
 * The role itself does NOT carry purpose / lawfulBasis / annexIIIDomain
 * (those live on top-level agents, defined via defineAgent). A role
 * declares lawfulBasis only if its data classification requires one.
 */

import { createHash } from 'node:crypto'
import { canonicalize } from '../evidence/canonical.js'
import { DEFAULT_RETENTION } from '../types/compliance.js'
import type {
  AgentRoleDefinition,
  DefineAgentRoleInput,
  OutputViews,
} from '../types/role.js'

const sha256 = (s: string): string =>
  createHash('sha256').update(s).digest('hex')

export const defineAgentRole = <TBaseOut, TViews extends OutputViews = OutputViews>(
  spec: DefineAgentRoleInput<TBaseOut, TViews>,
): AgentRoleDefinition<TBaseOut, TViews> => {
  const instructions =
    typeof spec.instructions === 'string'
      ? { resolved: spec.instructions, sha256: sha256(spec.instructions) }
      : spec.instructions

  const context = spec.context ?? []

  // Validate: tools must not exceed the role's data classification ceiling.
  if (spec.dataClassification !== 'inherit-from-parent') {
    for (const tool of spec.tools) {
      const toolClass = tool.dataClassification
      if (toolClass === 'special-category' && spec.dataClassification !== 'special-category') {
        throw new Error(
          `Role "${spec.name}": tool "${tool.name}" has dataClassification="special-category" ` +
            `but role ceiling is "${spec.dataClassification}". Tighten the ceiling or remove the tool.`,
        )
      }
      if (
        toolClass === 'personal' &&
        spec.dataClassification !== 'special-category' &&
        spec.dataClassification !== 'personal'
      ) {
        throw new Error(
          `Role "${spec.name}": tool "${tool.name}" has dataClassification="personal" ` +
            `but role ceiling is "${spec.dataClassification}". Tighten the ceiling or remove the tool.`,
        )
      }
    }
  }

  // Residency: roles touching personal/special-category data must declare residency.
  const cls = spec.dataClassification
  if ((cls === 'personal' || cls === 'special-category') && !spec.residency) {
    throw new Error(
      `Role "${spec.name}": dataClassification="${cls}" requires explicit residency declaration.`,
    )
  }

  const outputViews = (spec.outputViews ?? {}) as TViews
  const viewNames = Object.keys(outputViews).sort()

  const fingerprint = canonicalize({
    name: spec.name,
    instructionsHash: instructions.sha256,
    context: context.map((c) => ({ path: c.path, sha256: c.sha256 })),
    tools: spec.tools.map((t) => ({ name: t.name, dataClassification: t.dataClassification })),
    dataClassification: cls,
    lawfulBasis: spec.lawfulBasis ?? null,
    residency: spec.residency ?? null,
    outputViews: viewNames,
  })
  const roleHash = sha256(fingerprint)

  return {
    name: spec.name,
    instructions: instructions.resolved,
    instructionsHash: instructions.sha256,
    context,
    tools: spec.tools,
    dataClassification: cls,
    lawfulBasis: spec.lawfulBasis ?? null,
    residency: spec.residency ?? null,
    outputSchema: spec.outputSchema,
    outputViews,
    maxSteps: spec.maxSteps ?? 8,
    ...(spec.retry ? { retry: spec.retry } : {}),
    retention: spec.retention ?? DEFAULT_RETENTION,
    requiresPrincipal: spec.requiresPrincipal ?? false,
    requiresTenant: spec.requiresTenant ?? false,
    ...(spec.memory ? { memory: spec.memory } : {}),
    roleHash,
  }
}
