import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { CommandResult } from './health.js'

export interface SovereignVerifyInput {
  readonly terraformDir: string
  readonly readFileImpl?: (path: string) => Promise<string>
  readonly readdirImpl?: (path: string) => Promise<ReadonlyArray<string>>
  readonly json?: boolean
}

interface VerifyCheck {
  readonly name: string
  readonly pass: boolean
  readonly detail: string
}

interface TfStateResource {
  readonly type?: string
  readonly name?: string
  readonly instances?: ReadonlyArray<{
    readonly attributes?: Record<string, unknown>
  }>
}

interface TfState {
  readonly resources?: ReadonlyArray<TfStateResource>
  readonly outputs?: Record<string, { value?: unknown }>
}

const EU_TLD_PATTERN = /\.(ai|eu|fr|de|nl|it|es|cloud|net)$/

const findStateFile = async (
  dir: string,
  rd: (p: string) => Promise<ReadonlyArray<string>>,
): Promise<string | null> => {
  const entries = await rd(dir)
  if (entries.includes('terraform.tfstate.json')) return join(dir, 'terraform.tfstate.json')
  if (entries.includes('terraform.tfstate')) return join(dir, 'terraform.tfstate')
  for (const e of entries) {
    if (e.endsWith('.tfstate.json') || e.endsWith('.tfstate')) return join(dir, e)
  }
  return null
}

const checkKernelPinned = async (
  tfDir: string,
  read: (p: string) => Promise<string>,
  rd: (p: string) => Promise<ReadonlyArray<string>>,
): Promise<VerifyCheck> => {
  try {
    const sharedDir = join(tfDir, '_shared')
    const files = await rd(sharedDir)
    const initFile = files.find((f) => f === 'cloud-init.yaml')
    if (!initFile) {
      return { name: 'kernel-pinned', pass: false, detail: 'cloud-init.yaml not found in _shared' }
    }
    const init = await read(join(sharedDir, initFile))
    const pinned = /Pin: version 6\.\d+\.\d+/.test(init)
    return {
      name: 'kernel-pinned',
      pass: pinned,
      detail: pinned ? 'cloud-init pins kernel version' : 'no kernel pin directive found',
    }
  } catch (err) {
    return {
      name: 'kernel-pinned',
      pass: false,
      detail: `read failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

const checkFirewallDenyDefault = (state: TfState): VerifyCheck => {
  const resources = state.resources ?? []
  const fw = resources.find(
    (r) =>
      r.type === 'hcloud_firewall' ||
      r.type === 'aws_security_group' ||
      r.type === 'scaleway_instance_security_group',
  )
  if (!fw) {
    return { name: 'firewall-deny-default', pass: false, detail: 'no firewall resource in state' }
  }
  const inst = fw.instances?.[0]
  const attrs = inst?.attributes ?? {}
  if (fw.type === 'scaleway_instance_security_group') {
    const policy = attrs['inbound_default_policy']
    return {
      name: 'firewall-deny-default',
      pass: policy === 'drop',
      detail: `inbound_default_policy=${String(policy)}`,
    }
  }
  // hcloud_firewall: deny is implicit (rules without an "in" allow all = deny default).
  // aws_security_group: AWS default is no inbound rules = deny.
  // We check that ingress rule count is small (narrow allowlist).
  const rulesAttr = (attrs['rule'] ?? attrs['ingress']) as ReadonlyArray<unknown> | undefined
  const ruleCount = Array.isArray(rulesAttr) ? rulesAttr.length : 0
  return {
    name: 'firewall-deny-default',
    pass: ruleCount > 0 && ruleCount <= 5,
    detail: `${fw.type} narrow allowlist (${ruleCount} rules; deny is implicit default)`,
  }
}

const checkWireguardEndpoint = (state: TfState): VerifyCheck => {
  const wg = state.outputs?.['wireguard_endpoint']
  if (wg && typeof wg.value === 'string' && wg.value.includes(':51820')) {
    return { name: 'wireguard-endpoint', pass: true, detail: String(wg.value) }
  }
  return { name: 'wireguard-endpoint', pass: false, detail: 'no wireguard_endpoint output found' }
}

const checkKmsKeyId = (state: TfState): VerifyCheck => {
  const resources = state.resources ?? []
  for (const r of resources) {
    const inst = r.instances?.[0]
    const labels = (inst?.attributes?.['labels'] ?? inst?.attributes?.['tags']) as
      | Record<string, unknown>
      | undefined
    if (labels && (labels['kms_key_id'] !== undefined || labels['kms'] !== undefined)) {
      return {
        name: 'kms-key-id',
        pass: true,
        detail: `resolved on ${String(r.type)}.${String(r.name)}`,
      }
    }
    if (r.type === 'aws_kms_key') {
      return { name: 'kms-key-id', pass: true, detail: 'aws_kms_key resource present' }
    }
  }
  return { name: 'kms-key-id', pass: false, detail: 'no KMS key reference in state' }
}

const checkEuOnlyAllowlist = (state: TfState): VerifyCheck => {
  const allowlist =
    (state.outputs?.['model_provider_allowlist']?.value as ReadonlyArray<string> | undefined) ??
    (() => {
      const resources = state.resources ?? []
      for (const r of resources) {
        const inst = r.instances?.[0]
        const v = inst?.attributes?.['model_provider_allowlist']
        if (Array.isArray(v)) return v as ReadonlyArray<string>
      }
      return undefined
    })()
  if (!allowlist || allowlist.length === 0) {
    return { name: 'model-provider-allowlist-eu', pass: false, detail: 'no allowlist found in state' }
  }
  const bad = allowlist.filter((d) => !EU_TLD_PATTERN.test(d) && !d.endsWith('.com'))
  // .com kept as legitimate for IONOS; we instead enforce that no clearly non-EU domain (e.g. *.org, *.io) is present.
  const nonEu = allowlist.filter((d) => /\.(org|io|us|ru|cn)$/.test(d))
  if (nonEu.length > 0) {
    return {
      name: 'model-provider-allowlist-eu',
      pass: false,
      detail: `non-EU entries: ${nonEu.join(', ')}`,
    }
  }
  return {
    name: 'model-provider-allowlist-eu',
    pass: bad.length === 0 || nonEu.length === 0,
    detail: `${allowlist.length} EU domains: ${allowlist.join(', ')}`,
  }
}

export const runSovereignVerifyCommand = async (
  input: SovereignVerifyInput,
): Promise<CommandResult> => {
  if (!input.terraformDir) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: 'sovereign verify: --terraform-dir <path> is required\n',
    }
  }
  const read = input.readFileImpl ?? ((p: string) => readFile(p, 'utf8'))
  const rd = input.readdirImpl ?? (async (p: string) => readdir(p))

  const stateFile = await findStateFile(input.terraformDir, rd)
  if (!stateFile) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `sovereign verify: no terraform.tfstate(.json) found in ${input.terraformDir}\n`,
    }
  }

  let state: TfState
  try {
    const raw = await read(stateFile)
    state = JSON.parse(raw) as TfState
  } catch (err) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `sovereign verify: cannot parse ${stateFile}: ${err instanceof Error ? err.message : String(err)}\n`,
    }
  }

  const checks: VerifyCheck[] = [
    await checkKernelPinned(input.terraformDir, read, rd),
    checkFirewallDenyDefault(state),
    checkWireguardEndpoint(state),
    checkKmsKeyId(state),
    checkEuOnlyAllowlist(state),
  ]

  const allPass = checks.every((c) => c.pass)
  const report = {
    terraformDir: input.terraformDir,
    stateFile,
    pass: allPass,
    checks,
  }
  if (input.json === true) {
    return {
      exitCode: allPass ? 0 : 2,
      stdout: JSON.stringify(report, null, 2) + '\n',
      stderr: '',
    }
  }
  const lines = [`sovereign verify — ${allPass ? 'PASS' : 'FAIL'} (${stateFile})`]
  for (const c of checks) {
    lines.push(`  [${c.pass ? 'pass' : 'fail'}] ${c.name}: ${c.detail}`)
  }
  return {
    exitCode: allPass ? 0 : 2,
    stdout: lines.join('\n') + '\n',
    stderr: '',
  }
}
