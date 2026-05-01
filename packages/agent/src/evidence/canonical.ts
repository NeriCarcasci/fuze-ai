type Json = null | boolean | number | string | readonly Json[] | { readonly [k: string]: Json }

const isPlainObject = (v: unknown): v is Record<string, unknown> => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

const escapeString = (s: string): string => {
  let out = '"'
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    if (ch === 0x22) out += '\\"'
    else if (ch === 0x5c) out += '\\\\'
    else if (ch === 0x08) out += '\\b'
    else if (ch === 0x09) out += '\\t'
    else if (ch === 0x0a) out += '\\n'
    else if (ch === 0x0c) out += '\\f'
    else if (ch === 0x0d) out += '\\r'
    else if (ch < 0x20) out += `\\u${ch.toString(16).padStart(4, '0')}`
    else out += s[i]
  }
  return out + '"'
}

const formatNumber = (n: number): string => {
  if (!Number.isFinite(n)) throw new Error(`canonical: non-finite number ${n}`)
  if (Number.isInteger(n) && Math.abs(n) < 1e21) return n.toString()
  return n.toString()
}

export const canonicalize = (value: unknown): string => {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return formatNumber(value)
  if (typeof value === 'string') return escapeString(value)
  if (Array.isArray(value)) {
    return '[' + value.map((v) => canonicalize(v)).join(',') + ']'
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort()
    const parts: string[] = []
    for (const k of keys) {
      const v = value[k]
      if (v === undefined) continue
      parts.push(escapeString(k) + ':' + canonicalize(v))
    }
    return '{' + parts.join(',') + '}'
  }
  throw new Error(`canonical: unsupported value type: ${typeof value}`)
}

export type CanonicalJson = Json
