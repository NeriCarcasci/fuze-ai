import { createHash } from 'node:crypto'
import { canonicalize } from '@fuze-ai/agent'
import type { Manifest, ManifestDiff, SubProcessor } from './types.js'

const sortByName = (subs: readonly SubProcessor[]): SubProcessor[] =>
  [...subs].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

const canonicalSubProcessor = (s: SubProcessor): Record<string, unknown> => ({
  name: s.name,
  role: s.role,
  country: s.country,
  residency: s.residency,
  dataCategories: [...s.dataCategories].sort(),
  addedAt: s.addedAt,
})

export const manifestHash = (subProcessors: readonly SubProcessor[]): string => {
  const canonical = canonicalize(sortByName(subProcessors).map(canonicalSubProcessor))
  return createHash('sha256').update(canonical).digest('hex')
}

export const subProcessorManifest = (subProcessors: readonly SubProcessor[]): Manifest => ({
  version: '1',
  hash: manifestHash(subProcessors),
  subProcessors: sortByName(subProcessors),
})

const equalSubProcessor = (a: SubProcessor, b: SubProcessor): boolean =>
  canonicalize(canonicalSubProcessor(a)) === canonicalize(canonicalSubProcessor(b))

export const manifestDiff = (prev: Manifest, next: Manifest): ManifestDiff => {
  const prevByName = new Map(prev.subProcessors.map((s) => [s.name, s]))
  const nextByName = new Map(next.subProcessors.map((s) => [s.name, s]))

  const added: SubProcessor[] = []
  const removed: SubProcessor[] = []
  const changed: { prev: SubProcessor; next: SubProcessor }[] = []

  for (const [name, n] of nextByName) {
    const p = prevByName.get(name)
    if (!p) added.push(n)
    else if (!equalSubProcessor(p, n)) changed.push({ prev: p, next: n })
  }
  for (const [name, p] of prevByName) {
    if (!nextByName.has(name)) removed.push(p)
  }

  return { added, removed, changed }
}
