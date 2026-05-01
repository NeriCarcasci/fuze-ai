import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import {
  generateTfVars,
  getModule,
  type CloudTarget,
  type DeploymentSpec,
  type KmsProvider,
} from '@fuze-ai/agent-sovereign-terraform'
import type { CommandResult } from './health.js'

export interface SovereignInitInput {
  readonly cloud: string
  readonly tenant: string
  readonly outputDir: string
  readonly region?: string
  readonly modelProviders?: ReadonlyArray<string>
  readonly operatorWgPubkeys?: ReadonlyArray<string>
  readonly kmsProvider?: string
  readonly kmsKeyId?: string
  readonly mkdirImpl?: (path: string, opts: { recursive: true }) => Promise<unknown>
  readonly writeFileImpl?: (path: string, data: string) => Promise<void>
  readonly readFileImpl?: (path: string) => Promise<string>
  readonly readdirImpl?: (path: string) => Promise<ReadonlyArray<string>>
  readonly resolveModuleRoot?: () => string
}

const VALID_CLOUDS: ReadonlyArray<CloudTarget> = ['hetzner', 'scaleway', 'ovh', 'aws']
const VALID_KMS: ReadonlyArray<KmsProvider> = ['aws-kms', 'hcvault', 'ionos-kms', 'scw-kms']

const isCloud = (s: string): s is CloudTarget => (VALID_CLOUDS as ReadonlyArray<string>).includes(s)
const isKms = (s: string): s is KmsProvider => (VALID_KMS as ReadonlyArray<string>).includes(s)

const defaultRegion = (cloud: CloudTarget): string =>
  cloud === 'hetzner'
    ? 'fsn1'
    : cloud === 'scaleway'
      ? 'fr-par-1'
      : cloud === 'ovh'
        ? 'GRA9'
        : 'eu-west-1'

const resolveModuleRootDefault = (): string => {
  const here = dirname(fileURLToPath(import.meta.url))
  const require = createRequire(import.meta.url)
  try {
    const pkgPath = require.resolve('@fuze-ai/agent-sovereign-terraform/package.json')
    return resolve(dirname(pkgPath), 'modules')
  } catch {
    return resolve(here, '..', '..', '..', 'agent-sovereign-terraform', 'modules')
  }
}

const copyModule = async (
  cloud: CloudTarget,
  destDir: string,
  ops: {
    moduleRoot: string
    mk: (p: string, o: { recursive: true }) => Promise<unknown>
    write: (p: string, d: string) => Promise<void>
    read: (p: string) => Promise<string>
    rd: (p: string) => Promise<ReadonlyArray<string>>
  },
): Promise<ReadonlyArray<string>> => {
  const moduleName = `${cloud}-sovereign`
  const srcDir = join(ops.moduleRoot, moduleName)
  const sharedSrcDir = join(ops.moduleRoot, '_shared')
  const tfDir = join(destDir, 'terraform')
  const sharedDestDir = join(tfDir, '_shared')
  await ops.mk(tfDir, { recursive: true })
  await ops.mk(sharedDestDir, { recursive: true })

  const written: string[] = []
  for (const f of await ops.rd(srcDir)) {
    if (!f.endsWith('.tf')) continue
    const src = await ops.read(join(srcDir, f))
    const dst = join(tfDir, f)
    await ops.write(dst, src)
    written.push(dst)
  }
  for (const f of await ops.rd(sharedSrcDir)) {
    const src = await ops.read(join(sharedSrcDir, f))
    const dst = join(sharedDestDir, f)
    await ops.write(dst, src)
    written.push(dst)
  }
  return written
}

export const runSovereignInitCommand = async (input: SovereignInitInput): Promise<CommandResult> => {
  if (!input.cloud || !isCloud(input.cloud)) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `sovereign init: --cloud must be one of ${VALID_CLOUDS.join(', ')}\n`,
    }
  }
  if (!input.tenant) {
    return { exitCode: 1, stdout: '', stderr: 'sovereign init: --tenant <id> is required\n' }
  }
  if (!input.outputDir) {
    return { exitCode: 1, stdout: '', stderr: 'sovereign init: --output-dir <path> is required\n' }
  }
  const kmsProvider = input.kmsProvider ?? 'hcvault'
  if (!isKms(kmsProvider)) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `sovereign init: --kms-provider must be one of ${VALID_KMS.join(', ')}\n`,
    }
  }

  const cloud: CloudTarget = input.cloud
  const region = input.region ?? defaultRegion(cloud)
  const modelProviders = input.modelProviders ?? ['mistral.ai', 'scw.cloud', 'ovh.net', 'ionos.com']
  const wgPubkeys = input.operatorWgPubkeys ?? []
  const kmsKeyId = input.kmsKeyId ?? `placeholder://kms/${input.tenant}`

  const spec: DeploymentSpec = {
    tenant_id: input.tenant,
    cloud,
    region,
    model_providers: modelProviders,
    operator_wg_pubkeys: wgPubkeys,
    kms_provider: kmsProvider,
    kms_key_id: kmsKeyId,
  }

  let tfVars
  try {
    tfVars = generateTfVars(spec)
  } catch (err) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `sovereign init: ${err instanceof Error ? err.message : String(err)}\n`,
    }
  }

  const mk = input.mkdirImpl ?? ((p, o) => mkdir(p, o))
  const write = input.writeFileImpl ?? ((p, d) => writeFile(p, d, 'utf8'))
  const read = input.readFileImpl ?? ((p) => readFile(p, 'utf8'))
  const rd = input.readdirImpl ?? (async (p) => readdir(p))
  const moduleRoot = (input.resolveModuleRoot ?? resolveModuleRootDefault)()

  try {
    await mk(input.outputDir, { recursive: true })
    const tfvarsPath = join(input.outputDir, `${input.tenant}.tfvars`)
    const tfvarsJsonPath = join(input.outputDir, `${input.tenant}.tfvars.json`)
    await write(tfvarsPath, tfVars.varsHcl)
    await write(tfvarsJsonPath, tfVars.varsJson)
    const copied = await copyModule(cloud, input.outputDir, { moduleRoot, mk, write, read, rd })

    const inv = getModule(cloud)
    const summary = {
      cloud,
      module: tfVars.module,
      region,
      tenant: input.tenant,
      tfvars: tfvarsPath,
      tfvarsJson: tfvarsJsonPath,
      terraformFiles: copied,
      euResidencyClaim: inv.euResidencyClaim,
    }
    return { exitCode: 0, stdout: JSON.stringify(summary, null, 2) + '\n', stderr: '' }
  } catch (err) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `sovereign init: write failed: ${err instanceof Error ? err.message : String(err)}\n`,
    }
  }
}
