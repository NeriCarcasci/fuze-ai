import { describe, expect, it, vi } from 'vitest'
import { runSovereignVerifyCommand } from '../../src/commands/sovereign-verify.js'

const goodCloudInit = `#cloud-config
packages:
  - wireguard
write_files:
  - content: |
      Pin: version 6.8.0-45
`

const goodState = {
  resources: [
    {
      type: 'hcloud_firewall',
      name: 'sovereign',
      instances: [
        {
          attributes: {
            rule: [
              { direction: 'in', protocol: 'udp', port: '51820' },
              { direction: 'in', protocol: 'tcp', port: '443' },
              { direction: 'out', protocol: 'tcp', port: '443' },
            ],
            model_provider_allowlist: ['mistral.ai', 'scw.cloud', 'ovh.net'],
          },
        },
      ],
    },
    {
      type: 'hcloud_server',
      name: 'control_plane',
      instances: [
        {
          attributes: {
            labels: { tenant: 'acme', kms_key_id: 'vault://k/acme' },
          },
        },
      ],
    },
  ],
  outputs: {
    wireguard_endpoint: { value: '203.0.113.10:51820' },
  },
}

const buildOps = (state: unknown, cloudInit = goodCloudInit) => ({
  readFileImpl: vi.fn(async (p: string) => {
    if (p.endsWith('cloud-init.yaml')) return cloudInit
    if (p.endsWith('.tfstate.json') || p.endsWith('.tfstate')) return JSON.stringify(state)
    throw new Error(`unexpected read: ${p}`)
  }),
  readdirImpl: vi.fn(async (p: string) => {
    if (p.endsWith('_shared')) return ['cloud-init.yaml']
    return ['terraform.tfstate.json', '_shared']
  }),
})

describe('sovereign verify command', () => {
  it('errors when --terraform-dir is missing', async () => {
    const r = await runSovereignVerifyCommand({ terraformDir: '' })
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toContain('--terraform-dir')
  })

  it('passes a well-formed state', async () => {
    const ops = buildOps(goodState)
    const r = await runSovereignVerifyCommand({
      terraformDir: '/tmp/tf',
      json: true,
      ...ops,
    })
    expect(r.exitCode).toBe(0)
    const parsed = JSON.parse(r.stdout) as { pass: boolean }
    expect(parsed.pass).toBe(true)
  })

  it('fails when allowlist contains a non-EU domain', async () => {
    const bad = JSON.parse(JSON.stringify(goodState)) as typeof goodState
    bad.resources[0]!.instances![0]!.attributes!['model_provider_allowlist'] = [
      'mistral.ai',
      'openai.org',
    ]
    const ops = buildOps(bad)
    const r = await runSovereignVerifyCommand({
      terraformDir: '/tmp/tf',
      json: true,
      ...ops,
    })
    expect(r.exitCode).toBe(2)
    const parsed = JSON.parse(r.stdout) as { pass: boolean; checks: { name: string; pass: boolean }[] }
    expect(parsed.pass).toBe(false)
    const allow = parsed.checks.find((c) => c.name === 'model-provider-allowlist-eu')
    expect(allow?.pass).toBe(false)
  })

  it('fails when kernel pin is missing from cloud-init', async () => {
    const ops = buildOps(goodState, '#cloud-config\n# no pin here\n')
    const r = await runSovereignVerifyCommand({
      terraformDir: '/tmp/tf',
      json: true,
      ...ops,
    })
    expect(r.exitCode).toBe(2)
    const parsed = JSON.parse(r.stdout) as { checks: { name: string; pass: boolean }[] }
    const kernel = parsed.checks.find((c) => c.name === 'kernel-pinned')
    expect(kernel?.pass).toBe(false)
  })
})
