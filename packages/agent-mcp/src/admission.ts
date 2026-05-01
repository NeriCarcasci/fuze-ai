import type { McpAdmission } from './types.js'

export class AdmissionRefusedError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'AdmissionRefusedError'
    this.code = code
  }
}

export interface DiscoveredToolDescriptor {
  readonly name: string
  readonly description: string
}

export const validateAdmission = (admission: McpAdmission): void => {
  if (admission.sandboxTier === 'in-process') {
    throw new AdmissionRefusedError(
      'sandbox_tier_forbidden',
      `admission for '${admission.serverId}' refused: in-process sandbox tier is not allowed for MCP servers`,
    )
  }
  if (!admission.fingerprint || !admission.fingerprint.digest) {
    throw new AdmissionRefusedError(
      'missing_fingerprint',
      `admission for '${admission.serverId}' refused: server fingerprint required`,
    )
  }
  if (admission.maxDescriptionLength <= 0) {
    throw new AdmissionRefusedError(
      'invalid_description_cap',
      `admission for '${admission.serverId}' refused: maxDescriptionLength must be positive`,
    )
  }
}

export const filterDiscoveredTools = <T extends DiscoveredToolDescriptor>(
  admission: McpAdmission,
  discovered: readonly T[],
): readonly T[] => {
  const allowed = new Set(admission.allowedToolNames)
  return discovered.filter((t) => {
    if (!allowed.has(t.name)) return false
    if (t.description.length > admission.maxDescriptionLength) return false
    return true
  })
}

export const isToolNameAllowed = (admission: McpAdmission, name: string): boolean => {
  return admission.allowedToolNames.includes(name)
}
