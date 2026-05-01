import type { FuzeGuardrail, GuardrailResult } from '@fuze-ai/agent'

export interface ResidencyGuardrailOptions {
  readonly allowedDomains: readonly string[]
  readonly allowedTlds?: readonly string[]
  readonly name?: string
}

interface Violation {
  readonly url: string
  readonly reason: string
}

const URL_RE = /\bhttps?:\/\/[^\s"'<>)\]}]+/gi

const walkStrings = (value: unknown, sink: (s: string) => void, seen: WeakSet<object>): void => {
  if (typeof value === 'string') {
    sink(value)
    return
  }
  if (value === null || typeof value !== 'object') return
  if (seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    for (const v of value) walkStrings(v, sink, seen)
    return
  }
  for (const v of Object.values(value as Record<string, unknown>)) {
    walkStrings(v, sink, seen)
  }
}

const normalizeDomain = (d: string): string => d.toLowerCase().replace(/^\./, '')

const hostMatchesAllowedDomain = (host: string, allowed: readonly string[]): boolean => {
  const h = host.toLowerCase()
  for (const raw of allowed) {
    const a = normalizeDomain(raw)
    if (h === a || h.endsWith(`.${a}`)) return true
  }
  return false
}

const hostTld = (host: string): string | undefined => {
  const idx = host.lastIndexOf('.')
  if (idx < 0 || idx === host.length - 1) return undefined
  return host.slice(idx + 1).toLowerCase()
}

export const residencyGuardrail = (
  opts: ResidencyGuardrailOptions,
): FuzeGuardrail<unknown, unknown> => {
  const name = opts.name ?? 'fuze.residency.allowlist'
  const allowedDomains = opts.allowedDomains.map(normalizeDomain)
  const allowedTlds = (opts.allowedTlds ?? []).map((t) => t.toLowerCase().replace(/^\./, ''))

  return {
    name,
    phase: 'output',
    kind: 'tripwire',
    async evaluate(_ctx, payload): Promise<GuardrailResult> {
      const violations: Violation[] = []
      const seenUrls = new Set<string>()

      const onString = (s: string): void => {
        URL_RE.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = URL_RE.exec(s)) !== null) {
          const raw = m[0].replace(/[.,;:!?)\]}]+$/, '')
          if (seenUrls.has(raw)) continue
          seenUrls.add(raw)
          let host: string
          try {
            host = new URL(raw).hostname
          } catch {
            violations.push({ url: raw, reason: 'unparseable' })
            continue
          }
          if (hostMatchesAllowedDomain(host, allowedDomains)) continue
          const tld = hostTld(host)
          if (tld !== undefined && allowedTlds.includes(tld)) continue
          violations.push({ url: raw, reason: tld === undefined ? 'no-tld' : `tld-not-allowed:${tld}` })
        }
      }

      walkStrings(payload, onString, new WeakSet())
      return {
        tripwire: violations.length > 0,
        evidence: { 'residency.violations': violations },
      }
    },
  }
}
