import type { Finding, LayeredMode, PiiKind, RedactionEngine, RedactionResult } from './types.js'

export interface LayeredRedactionEngineOptions {
  readonly engines: readonly RedactionEngine[]
  readonly mode: LayeredMode
  readonly name?: string
}

interface MergedEntry {
  count: number
  fields: Set<string>
}

const mergeUnion = (results: readonly RedactionResult[]): readonly Finding[] => {
  const map = new Map<PiiKind, MergedEntry>()
  for (const r of results) {
    for (const f of r.findings) {
      const e = map.get(f.kind) ?? { count: 0, fields: new Set<string>() }
      e.count += f.count
      for (const path of f.fields) e.fields.add(path)
      map.set(f.kind, e)
    }
  }
  const out: Finding[] = []
  for (const [kind, e] of map) {
    out.push({ kind, count: e.count, fields: Array.from(e.fields).sort() })
  }
  out.sort((a, b) => a.kind.localeCompare(b.kind))
  return out
}

const mergeIntersection = (results: readonly RedactionResult[]): readonly Finding[] => {
  if (results.length === 0) return []
  const perEngine: Map<PiiKind, Finding>[] = results.map((r) => {
    const m = new Map<PiiKind, Finding>()
    for (const f of r.findings) m.set(f.kind, f)
    return m
  })
  const first = perEngine[0]
  if (first === undefined) return []
  const out: Finding[] = []
  for (const [kind, f0] of first) {
    let inAll = true
    let minCount = f0.count
    const fields = new Set<string>(f0.fields)
    for (let i = 1; i < perEngine.length; i++) {
      const m = perEngine[i]
      const fi = m === undefined ? undefined : m.get(kind)
      if (fi === undefined) {
        inAll = false
        break
      }
      if (fi.count < minCount) minCount = fi.count
      for (const path of fi.fields) fields.add(path)
    }
    if (inAll) out.push({ kind, count: minCount, fields: Array.from(fields).sort() })
  }
  out.sort((a, b) => a.kind.localeCompare(b.kind))
  return out
}

export class LayeredRedactionEngine implements RedactionEngine {
  readonly name: string
  readonly #engines: readonly RedactionEngine[]
  readonly #mode: LayeredMode

  constructor(opts: LayeredRedactionEngineOptions) {
    this.name = opts.name ?? `fuze.redaction.layered.${opts.mode}`
    this.#engines = opts.engines
    this.#mode = opts.mode
  }

  async redact(value: unknown): Promise<RedactionResult> {
    const results = await Promise.all(this.#engines.map((e) => e.redact(value)))
    const findings = this.#mode === 'union' ? mergeUnion(results) : mergeIntersection(results)
    let confidence: number
    if (results.length === 0) {
      confidence = 1
    } else if (this.#mode === 'union') {
      let max = 0
      for (const r of results) if (r.confidence > max) max = r.confidence
      confidence = max
    } else {
      let min = 1
      for (const r of results) if (r.confidence < min) min = r.confidence
      confidence = min
    }
    const last = results[results.length - 1]
    const value0 = last === undefined ? value : last.value
    return { value: value0, findings, confidence }
  }
}
