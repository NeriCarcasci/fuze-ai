import type { AdequacyStatus, SccModule, SccSelection, TransferContext } from './types.js'

const SCC_EDITION = 'EU 2021/914 (Commission Implementing Decision of 4 June 2021)'

const isInsideEea = (a: AdequacyStatus): boolean => a === 'eu' || a === 'eea'
const hasAdequacy = (a: AdequacyStatus): boolean => isInsideEea(a) || a === 'adequacy'

const baseCustomizations: readonly string[] = [
  'Annex I.A — list parties and contact points',
  'Annex I.B — describe transfer (categories of data, frequency, retention)',
  'Annex I.C — designate competent supervisory authority',
  'Annex II — technical and organisational measures',
  'Annex III — list of sub-processors (where Module 2 or 3 applies)',
]

export const selectScc = (ctx: TransferContext): SccSelection => {
  const exporterEea = isInsideEea(ctx.controllerAdequacy)
  const importerAdequate = hasAdequacy(ctx.processorAdequacy)

  if (exporterEea && importerAdequate) {
    return {
      required: false,
      modules: [],
      rationale:
        'Importer is inside the EEA or covered by a Commission adequacy decision; SCCs are not required for the transfer itself, though Art. 28 DPA obligations still apply.',
      dockingClause: false,
      requiresTia: false,
      editionRef: SCC_EDITION,
      customizationsRequired: [],
    }
  }

  const modules: SccModule[] = []
  const c = ctx.controllerRole
  const p = ctx.processorRole
  if (c === 'controller' && p === 'controller') modules.push('module-1-c2c')
  if (c === 'controller' && p === 'processor') modules.push('module-2-c2p')
  if (c === 'processor' && p === 'processor') modules.push('module-3-p2p')
  if (c === 'processor' && p === 'controller') modules.push('module-4-p2c')

  const ambiguous = modules.length === 0
  if (ambiguous) {
    return {
      required: true,
      modules: ['module-2-c2p', 'module-3-p2p'],
      rationale:
        'Role mapping is ambiguous; reviewer must determine whether the importer acts as processor (Module 2) or as a downstream processor under another processor (Module 3).',
      dockingClause: true,
      requiresTia: !importerAdequate,
      editionRef: SCC_EDITION,
      customizationsRequired: baseCustomizations,
    }
  }

  const requiresTia = !importerAdequate
  const moduleLabel: Record<SccModule, string> = {
    'module-1-c2c': 'controller-to-controller',
    'module-2-c2p': 'controller-to-processor',
    'module-3-p2p': 'processor-to-processor',
    'module-4-p2c': 'processor-to-controller',
  }
  const first = modules[0] as SccModule
  return {
    required: true,
    modules,
    rationale: `Transfer from ${ctx.controllerCountry} (${ctx.controllerAdequacy}) to ${ctx.processorCountry} (${ctx.processorAdequacy}); ${moduleLabel[first]} mapping applies.`,
    dockingClause: true,
    requiresTia,
    editionRef: SCC_EDITION,
    customizationsRequired: baseCustomizations,
  }
}
