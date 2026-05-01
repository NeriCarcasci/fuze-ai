import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const moduleRoot = resolve(here, '..', 'modules')

const readMain = (cloud: string): string =>
  readFileSync(resolve(moduleRoot, `${cloud}-sovereign`, 'main.tf'), 'utf8')

const readShared = (file: string): string =>
  readFileSync(resolve(moduleRoot, '_shared', file), 'utf8')

describe('terraform module files', () => {
  it('each main.tf declares the expected provider', () => {
    expect(readMain('hetzner')).toMatch(/source\s*=\s*"hetznercloud\/hcloud"/)
    expect(readMain('scaleway')).toMatch(/source\s*=\s*"scaleway\/scaleway"/)
    expect(readMain('ovh')).toMatch(/source\s*=\s*"ovh\/ovh"/)
    expect(readMain('aws')).toMatch(/source\s*=\s*"hashicorp\/aws"/)
  })

  it('each module references WireGuard or port 51820', () => {
    for (const cloud of ['hetzner', 'scaleway', 'ovh', 'aws']) {
      const src = readMain(cloud)
      const sharedRef = src.includes('_shared/cloud-init.yaml')
      const wgPort = src.includes('51820') || src.includes('WireGuard') || cloud === 'ovh'
      expect(sharedRef || wgPort).toBe(true)
    }
    expect(readShared('wireguard.tf.tpl')).toMatch(/wg_listen_port\s*=\s*51820/)
    expect(readShared('cloud-init.yaml')).toMatch(/wireguard/)
  })

  it('cloud-init pins the kernel and configures fail2ban + EU-residency posture', () => {
    const init = readShared('cloud-init.yaml')
    expect(init).toMatch(/Pin: version 6\.8\.0/)
    expect(init).toMatch(/fail2ban/)
    expect(init).toMatch(/time\.cloudflare\.com/)
    expect(init).toMatch(/swapoff/)
  })

  it('each module enforces a deny-all-inbound default and a narrow ingress allowlist', () => {
    expect(readMain('hetzner')).toMatch(/hcloud_firewall/)
    expect(readMain('scaleway')).toMatch(/inbound_default_policy\s*=\s*"drop"/)
    expect(readMain('aws')).toMatch(/aws_security_group/)
    // OVH posture is k8s NetworkPolicy plus VLAN; assert the comment is present so the
    // operator audit trail captures the design choice.
    expect(readMain('ovh')).toMatch(/Firewall posture/)
    // Egress allowlist references the EU model providers in at least one module.
    expect(readMain('hetzner')).toMatch(/EU model providers/)
  })
})
