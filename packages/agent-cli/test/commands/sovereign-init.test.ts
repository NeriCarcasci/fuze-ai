import { describe, expect, it, vi } from 'vitest'
import { runSovereignInitCommand } from '../../src/commands/sovereign-init.js'

const fakeOps = () => {
  const written: Record<string, string> = {}
  const dirs: string[] = []
  return {
    written,
    dirs,
    mkdirImpl: vi.fn(async (p: string, _o: { recursive: true }) => {
      dirs.push(p)
    }),
    writeFileImpl: vi.fn(async (p: string, d: string) => {
      written[p] = d
    }),
    readFileImpl: vi.fn(async (p: string) => {
      if (p.endsWith('cloud-init.yaml')) return '#cloud-config\n# Pin: version 6.8.0-45\n'
      if (p.endsWith('main.tf')) return '// fake main\n'
      if (p.endsWith('variables.tf')) return '// fake vars\n'
      if (p.endsWith('outputs.tf')) return '// fake outputs\n'
      if (p.endsWith('wireguard.tf.tpl')) return '// fake wg\n'
      return '// fake\n'
    }),
    readdirImpl: vi.fn(async (p: string) => {
      if (p.endsWith('_shared')) return ['cloud-init.yaml', 'wireguard.tf.tpl']
      return ['main.tf', 'variables.tf', 'outputs.tf']
    }),
    resolveModuleRoot: () => '/fake/modules',
  }
}

describe('sovereign init command', () => {
  it('rejects an invalid cloud target', async () => {
    const r = await runSovereignInitCommand({
      cloud: 'gcp',
      tenant: 'acme',
      outputDir: '/tmp/out',
    })
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toContain('--cloud must be one of')
  })

  it('writes tfvars and copies module files for hetzner', async () => {
    const ops = fakeOps()
    const r = await runSovereignInitCommand({
      cloud: 'hetzner',
      tenant: 'acme-eu',
      outputDir: '/tmp/out',
      operatorWgPubkeys: ['ssh-ed25519 AAA op@host'],
      kmsKeyId: 'vault://k/acme',
      ...ops,
    })
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('"module": "hetzner-sovereign"')
    expect(Object.keys(ops.written).some((k) => k.endsWith('acme-eu.tfvars'))).toBe(true)
    expect(Object.keys(ops.written).some((k) => k.endsWith('acme-eu.tfvars.json'))).toBe(true)
    expect(Object.keys(ops.written).some((k) => k.includes('main.tf'))).toBe(true)
    expect(Object.keys(ops.written).some((k) => k.endsWith('cloud-init.yaml'))).toBe(true)
    const tfvars = Object.entries(ops.written).find(([k]) => k.endsWith('.tfvars'))?.[1]
    expect(tfvars).toContain('"acme-eu"')
  })

  it('rejects non-EU regions for scaleway', async () => {
    const ops = fakeOps()
    const r = await runSovereignInitCommand({
      cloud: 'scaleway',
      tenant: 'acme',
      outputDir: '/tmp/out',
      region: 'us-west-1',
      operatorWgPubkeys: ['ssh-ed25519 AAA op@host'],
      ...ops,
    })
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toContain('not EU-resident')
  })
})
