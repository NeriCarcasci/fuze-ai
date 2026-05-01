import { describe, expect, it } from 'vitest'
import {
  AdmissionRefusedError,
  filterDiscoveredTools,
  isToolNameAllowed,
  validateAdmission,
} from '../src/admission.js'
import type { McpAdmission } from '../src/types.js'

const base: McpAdmission = {
  serverId: 's1',
  allowedToolNames: ['echo', 'ping'],
  maxDescriptionLength: 100,
  fingerprint: { algorithm: 'sha256', digest: 'abc' },
  sandboxTier: 'vm-managed',
}

describe('admission helpers', () => {
  it('validateAdmission accepts a vm-managed admission', () => {
    expect(() => validateAdmission(base)).not.toThrow()
  })

  it('validateAdmission refuses sandboxTier in-process', () => {
    expect(() => validateAdmission({ ...base, sandboxTier: 'in-process' })).toThrow(
      AdmissionRefusedError,
    )
  })

  it('validateAdmission refuses non-positive maxDescriptionLength', () => {
    expect(() => validateAdmission({ ...base, maxDescriptionLength: 0 })).toThrow(
      AdmissionRefusedError,
    )
  })

  it('filterDiscoveredTools drops names not in allowlist and overlong descriptions', () => {
    const out = filterDiscoveredTools(base, [
      { name: 'echo', description: 'ok' },
      { name: 'forbidden', description: 'ok' },
      { name: 'ping', description: 'x'.repeat(500) },
    ])
    expect(out.map((t) => t.name)).toEqual(['echo'])
  })

  it('isToolNameAllowed reflects the closed-list policy', () => {
    expect(isToolNameAllowed(base, 'echo')).toBe(true)
    expect(isToolNameAllowed(base, 'forbidden')).toBe(false)
  })
})
