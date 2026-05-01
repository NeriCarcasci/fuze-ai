import { describe, expect, it } from 'vitest'
import { generateTfVars } from '../src/generator.js'
import type { DeploymentSpec } from '../src/types.js'

const baseSpec = (overrides: Partial<DeploymentSpec> = {}): DeploymentSpec => ({
  tenant_id: 'acme-eu',
  cloud: 'hetzner',
  region: 'fsn1',
  model_providers: ['mistral.ai', 'scw.cloud'],
  operator_wg_pubkeys: ['ssh-ed25519 AAAA... op@host'],
  kms_provider: 'hcvault',
  kms_key_id: 'vault://keys/fuze-acme-eu',
  ...overrides,
})

describe('generateTfVars', () => {
  it('generates valid HCL for each cloud', () => {
    for (const cloud of ['hetzner', 'scaleway', 'ovh', 'aws'] as const) {
      const region =
        cloud === 'hetzner'
          ? 'fsn1'
          : cloud === 'scaleway'
            ? 'fr-par-1'
            : cloud === 'ovh'
              ? 'GRA9'
              : 'eu-west-1'
      const out = generateTfVars(baseSpec({ cloud, region }))
      expect(out.module).toBe(`${cloud}-sovereign`)
      expect(out.varsHcl).toContain('tenant_id')
      expect(out.varsHcl).toContain('"acme-eu"')
      expect(out.varsHcl).toContain('wireguard_public_keys')
    }
  })

  it('refuses non-EU regions for hetzner/scaleway/ovh modules', () => {
    expect(() => generateTfVars(baseSpec({ cloud: 'hetzner', region: 'us-east' }))).toThrow(
      /not EU-resident/,
    )
    expect(() =>
      generateTfVars(baseSpec({ cloud: 'scaleway', region: 'us-west-1' })),
    ).toThrow(/not EU-resident/)
    expect(() => generateTfVars(baseSpec({ cloud: 'ovh', region: 'BHS5' }))).toThrow(
      /not EU-resident/,
    )
  })

  it('refuses non-EU AWS regions even though AWS supports them globally', () => {
    expect(() => generateTfVars(baseSpec({ cloud: 'aws', region: 'us-east-1' }))).toThrow(
      /eu-\* regions/,
    )
  })

  it('emits JSON output that parses', () => {
    const out = generateTfVars(baseSpec())
    const parsed = JSON.parse(out.varsJson) as Record<string, unknown>
    expect(parsed['tenant_id']).toBe('acme-eu')
    expect(Array.isArray(parsed['wireguard_public_keys'])).toBe(true)
    expect(parsed['model_provider_allowlist']).toEqual(['mistral.ai', 'scw.cloud'])
  })

  it('escapes string vars containing quotes and backslashes', () => {
    const out = generateTfVars(
      baseSpec({
        kms_key_id: 'vault://keys/with "quote" and \\backslash',
      }),
    )
    expect(out.varsHcl).toContain('\\"quote\\"')
    expect(out.varsHcl).toContain('\\\\backslash')
    const parsed = JSON.parse(out.varsJson) as Record<string, unknown>
    expect(parsed['kms_key_id']).toBe('vault://keys/with "quote" and \\backslash')
  })

  it('rejects empty operator_wg_pubkeys', () => {
    expect(() => generateTfVars(baseSpec({ operator_wg_pubkeys: [] }))).toThrow(
      /operator_wg_pubkeys/,
    )
  })

  it('rejects non-EU model providers', () => {
    expect(() =>
      generateTfVars(baseSpec({ model_providers: ['openai.org'] })),
    ).toThrow(/EU allowlist/)
  })
})
