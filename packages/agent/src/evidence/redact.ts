import { SECRET_REDACTED } from '../types/secrets.js'

const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-[A-Za-z0-9]{20,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /AIza[0-9A-Za-z_-]{35}/g,
  /ghp_[A-Za-z0-9]{36}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
]

const isSecretBranded = (v: unknown): boolean =>
  typeof v === 'object' && v !== null && (v as { [k: string]: unknown })['__brand'] === 'SecretRef'

export const redactString = (s: string): string => {
  let out = s
  for (const pat of SECRET_PATTERNS) {
    out = out.replace(pat, SECRET_REDACTED)
  }
  return out
}

export const redact = (value: unknown): unknown => {
  if (value === null || value === undefined) return value
  if (isSecretBranded(value)) return SECRET_REDACTED
  if (typeof value === 'string') return redactString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map((v) => redact(v))
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(obj)) {
      out[k] = redact(obj[k])
    }
    return out
  }
  return value
}
