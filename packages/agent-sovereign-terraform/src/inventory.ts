import type { CloudTarget, ModuleInventoryEntry } from './types.js'

const HETZNER_EU: ReadonlyArray<string> = ['fsn1', 'nbg1', 'hel1']
const SCALEWAY_EU: ReadonlyArray<string> = ['fr-par-1', 'fr-par-2', 'nl-ams-1', 'pl-waw-1']
const OVH_EU: ReadonlyArray<string> = ['GRA9', 'GRA11', 'SBG5', 'RBX-A', 'WAW1']
const AWS_EU: ReadonlyArray<string> = ['eu-west-1', 'eu-central-1', 'eu-west-3', 'eu-north-1']

const ENTRIES: ReadonlyArray<ModuleInventoryEntry> = [
  {
    name: 'hetzner-sovereign',
    cloud: 'hetzner',
    supportedRegions: HETZNER_EU,
    euResidencyClaim: 'Hetzner Online GmbH (DE) — data centers in Falkenstein, Nürnberg, Helsinki; GDPR controller agreement available.',
    modulePath: 'modules/hetzner-sovereign',
  },
  {
    name: 'scaleway-sovereign',
    cloud: 'scaleway',
    supportedRegions: SCALEWAY_EU,
    euResidencyClaim: 'Scaleway SAS (FR) — Paris, Amsterdam, Warsaw regions; SecNumCloud-aligned.',
    modulePath: 'modules/scaleway-sovereign',
  },
  {
    name: 'ovh-sovereign',
    cloud: 'ovh',
    supportedRegions: OVH_EU,
    euResidencyClaim: 'OVH Groupe SA (FR) — Gravelines, Strasbourg, Roubaix, Warsaw; SecNumCloud and ISO/IEC 27001 certified.',
    modulePath: 'modules/ovh-sovereign',
  },
  {
    name: 'aws-sovereign',
    cloud: 'aws',
    supportedRegions: AWS_EU,
    euResidencyClaim: 'AWS Europe (Ireland/Frankfurt/Paris/Stockholm) — operator must accept the AWS Data Privacy Framework; sovereignty caveats apply (US CLOUD Act).',
    modulePath: 'modules/aws-sovereign',
  },
]

export const listModules = (): ReadonlyArray<ModuleInventoryEntry> => ENTRIES

export const getModule = (cloud: CloudTarget): ModuleInventoryEntry => {
  const entry = ENTRIES.find((e) => e.cloud === cloud)
  if (!entry) throw new Error(`unknown cloud target: ${cloud}`)
  return entry
}

export const isEuRegion = (cloud: CloudTarget, region: string): boolean => {
  const entry = ENTRIES.find((e) => e.cloud === cloud)
  if (!entry) return false
  return entry.supportedRegions.includes(region)
}
