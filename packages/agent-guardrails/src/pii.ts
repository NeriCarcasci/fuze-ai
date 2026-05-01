// Phase 0: regex-only PII detection. Microsoft Presidio integration is deferred to Phase 3.
// Evidence reports counts only — raw matched values must never leave this module.

import type { FuzeGuardrail, GuardrailPhase, GuardrailResult } from '@fuze-ai/agent'

export type PiiKind = 'email' | 'phone' | 'iban' | 'ipv4' | 'creditCard'

export interface PiiGuardrailOptions {
  readonly phase?: Extract<GuardrailPhase, 'input' | 'toolResult'>
  readonly name?: string
  readonly kinds?: readonly PiiKind[]
}

interface MatchCount {
  readonly kind: PiiKind
  readonly count: number
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const PHONE_RE = /(?<![\d])\+[1-9]\d{7,14}(?![\d])/g
const IBAN_RE = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g
const IPV4_RE = /\b(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\b/g
const CC_RE = /\b(?:\d[ -]?){13,19}\b/g

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

const ibanChecksumValid = (raw: string): boolean => {
  const s = raw.toUpperCase()
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

const countAll = (re: RegExp, hay: string): number => {
  re.lastIndex = 0
  let n = 0
  while (re.exec(hay) !== null) n++
  return n
}

const countCreditCards = (hay: string): number => {
  CC_RE.lastIndex = 0
  let n = 0
  let m: RegExpExecArray | null
  while ((m = CC_RE.exec(hay)) !== null) {
    const digits = m[0].replace(/[ -]/g, '')
    if (luhnValid(digits)) n++
  }
  return n
}

const countIbans = (hay: string): number => {
  IBAN_RE.lastIndex = 0
  let n = 0
  let m: RegExpExecArray | null
  while ((m = IBAN_RE.exec(hay)) !== null) {
    if (ibanChecksumValid(m[0])) n++
  }
  return n
}

const stringifyPayload = (p: unknown): string => {
  if (typeof p === 'string') return p
  if (p === null || p === undefined) return ''
  try {
    return JSON.stringify(p)
  } catch {
    return ''
  }
}

const DEFAULT_KINDS: readonly PiiKind[] = ['email', 'phone', 'iban', 'ipv4', 'creditCard']

export const piiGuardrail = (opts: PiiGuardrailOptions = {}): FuzeGuardrail<unknown, unknown> => {
  const phase: Extract<GuardrailPhase, 'input' | 'toolResult'> = opts.phase ?? 'input'
  const name = opts.name ?? 'fuze.pii.regex'
  const enabled = new Set<PiiKind>(opts.kinds ?? DEFAULT_KINDS)

  return {
    name,
    phase,
    kind: 'tripwire',
    async evaluate(_ctx, payload): Promise<GuardrailResult> {
      const hay = stringifyPayload(payload)
      const matches: MatchCount[] = []
      if (enabled.has('email')) {
        const c = countAll(EMAIL_RE, hay)
        if (c > 0) matches.push({ kind: 'email', count: c })
      }
      if (enabled.has('phone')) {
        const c = countAll(PHONE_RE, hay)
        if (c > 0) matches.push({ kind: 'phone', count: c })
      }
      if (enabled.has('iban')) {
        const c = countIbans(hay)
        if (c > 0) matches.push({ kind: 'iban', count: c })
      }
      if (enabled.has('ipv4')) {
        const c = countAll(IPV4_RE, hay)
        if (c > 0) matches.push({ kind: 'ipv4', count: c })
      }
      if (enabled.has('creditCard')) {
        const c = countCreditCards(hay)
        if (c > 0) matches.push({ kind: 'creditCard', count: c })
      }
      return {
        tripwire: matches.length > 0,
        evidence: { 'pii.matches': matches },
      }
    },
  }
}
