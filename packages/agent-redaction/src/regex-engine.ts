import type { Finding, PiiKind, RedactionEngine, RedactionResult } from './types.js'

const REDACTED = '[REDACTED]'

interface PatternSpec {
  readonly kind: PiiKind
  readonly re: RegExp
  readonly validate?: (raw: string) => boolean
}

const ibanChecksumValid = (raw: string): boolean => {
  const s = raw.toUpperCase().replace(/\s+/g, '')
  if (s.length < 15) return false
  const rearranged = s.slice(4) + s.slice(0, 4)
  let remainder = 0
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0)
    const value = code >= 65 && code <= 90 ? code - 55 : code - 48
    if (value < 0 || value > 35) return false
    remainder = (remainder * (value > 9 ? 100 : 10) + value) % 97
  }
  return remainder === 1
}

const luhnValid = (digits: string): boolean => {
  let sum = 0
  let alt = false
  for (let i = digits.length - 1; i >= 0; i--) {
    const ch = digits.charAt(i)
    const d = Number.parseInt(ch, 10)
    if (Number.isNaN(d)) return false
    const v = alt ? (d * 2 > 9 ? d * 2 - 9 : d * 2) : d
    sum += v
    alt = !alt
  }
  return sum % 10 === 0 && digits.length >= 13
}

const codiceFiscaleValid = (raw: string): boolean => /^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/.test(raw.toUpperCase())

const PATTERNS: readonly PatternSpec[] = [
  { kind: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { kind: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { kind: 'oauth-bearer', re: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g },
  { kind: 'phone-de', re: /(?<![\w+])(?:\+49[\s-]?|0049[\s-]?|0)[1-9]\d{1,4}[\s-]?\d{3,10}(?![\w])/g },
  { kind: 'phone-fr', re: /(?<![\w+])(?:\+33[\s-]?|0033[\s-]?|0)[1-9](?:[\s.-]?\d{2}){4}(?![\w])/g },
  { kind: 'phone-it', re: /(?<![\w+])(?:\+39[\s-]?|0039[\s-]?)?(?:3\d{2}|0\d{1,3})[\s.-]?\d{6,8}(?![\w])/g },
  { kind: 'phone-es', re: /(?<![\w+])(?:\+34[\s-]?|0034[\s-]?)?[6-9]\d{2}[\s.-]?\d{3}[\s.-]?\d{3}(?![\w])/g },
  { kind: 'phone-uk', re: /(?<![\w+])(?:\+44[\s-]?|0044[\s-]?|0)(?:7\d{3}|1\d{2,3}|2\d|3\d{2}|800)[\s.-]?\d{3,4}[\s.-]?\d{3,4}(?![\w])/g },
  { kind: 'phone', re: /(?<![\d+])\+[1-9]\d{7,14}(?![\d])/g },
  { kind: 'iban', re: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g, validate: ibanChecksumValid },
  { kind: 'ipv4', re: /\b(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\b/g },
  { kind: 'ipv6', re: /\b(?:[A-Fa-f0-9]{1,4}:){7}[A-Fa-f0-9]{1,4}\b|\b(?:[A-Fa-f0-9]{1,4}:){1,7}:(?:[A-Fa-f0-9]{1,4}:){0,6}[A-Fa-f0-9]{1,4}\b/g },
  { kind: 'mac', re: /\b[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}\b/g },
  { kind: 'creditCard', re: /\b(?:\d[ -]?){13,19}\b/g, validate: (raw) => luhnValid(raw.replace(/[ -]/g, '')) },
  { kind: 'de-steuer-id', re: /(?<!\d)\d{11}(?!\d)/g },
  { kind: 'fr-insee', re: /(?<!\d)[12]\d{2}(?:0\d|1[0-2])(?:\d{2}|2[ABab])\d{3}\d{3}(?:\d{2})?(?!\d)/g },
  { kind: 'it-codice-fiscale', re: /\b[A-Za-z]{6}\d{2}[A-Za-z]\d{2}[A-Za-z]\d{3}[A-Za-z]\b/g, validate: codiceFiscaleValid },
]

interface ScanHit {
  readonly kind: PiiKind
  readonly start: number
  readonly end: number
}

const scan = (s: string): ScanHit[] => {
  const hits: ScanHit[] = []
  for (const spec of PATTERNS) {
    spec.re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = spec.re.exec(s)) !== null) {
      if (spec.validate && !spec.validate(m[0])) continue
      hits.push({ kind: spec.kind, start: m.index, end: m.index + m[0].length })
    }
  }
  return hits
}

const redactString = (s: string): { redacted: string; kinds: readonly PiiKind[] } => {
  const hits = scan(s).sort((a, b) => a.start - b.start || b.end - a.end)
  const merged: ScanHit[] = []
  for (const h of hits) {
    const last = merged[merged.length - 1]
    if (last !== undefined && h.start < last.end) continue
    merged.push(h)
  }
  if (merged.length === 0) return { redacted: s, kinds: [] }
  let out = ''
  let cursor = 0
  const kinds: PiiKind[] = []
  for (const h of merged) {
    out += s.slice(cursor, h.start) + REDACTED
    cursor = h.end
    kinds.push(h.kind)
  }
  out += s.slice(cursor)
  return { redacted: out, kinds }
}

interface WalkAccumulator {
  readonly findings: Map<PiiKind, { count: number; fields: Set<string> }>
}

const recordKinds = (acc: WalkAccumulator, kinds: readonly PiiKind[], path: string): void => {
  for (const k of kinds) {
    const entry = acc.findings.get(k) ?? { count: 0, fields: new Set<string>() }
    entry.count += 1
    if (path !== '') entry.fields.add(path)
    acc.findings.set(k, entry)
  }
}

const walk = (value: unknown, path: string, acc: WalkAccumulator): unknown => {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') {
    const { redacted, kinds } = redactString(value)
    recordKinds(acc, kinds, path)
    return redacted
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return value
  if (Array.isArray(value)) {
    return value.map((v, i) => walk(v, path === '' ? `[${i}]` : `${path}[${i}]`, acc))
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(obj)) {
      out[k] = walk(obj[k], path === '' ? k : `${path}.${k}`, acc)
    }
    return out
  }
  return value
}

const DEFAULT_NAME = 'fuze.redaction.regex'

export interface RegexRedactionEngineOptions {
  readonly name?: string
}

export class RegexRedactionEngine implements RedactionEngine {
  readonly name: string

  constructor(opts: RegexRedactionEngineOptions = {}) {
    this.name = opts.name ?? DEFAULT_NAME
  }

  async redact(value: unknown): Promise<RedactionResult> {
    const acc: WalkAccumulator = { findings: new Map() }
    const redacted = walk(value, '', acc)
    const findings: Finding[] = []
    for (const [kind, entry] of acc.findings) {
      findings.push({ kind, count: entry.count, fields: Array.from(entry.fields).sort() })
    }
    findings.sort((a, b) => a.kind.localeCompare(b.kind))
    return {
      value: redacted,
      findings,
      confidence: findings.length === 0 ? 1 : 0.9,
    }
  }
}
