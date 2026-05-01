export interface CelBindings {
  readonly R: { readonly attr: Readonly<Record<string, unknown>> }
  readonly P: { readonly attr: Readonly<Record<string, unknown>> }
}

type Clause =
  | { kind: 'eq'; lhs: AttrRef; literal: string }
  | { kind: 'ne'; lhs: AttrRef; literal: string }
  | { kind: 'in'; lhs: AttrRef; list: readonly string[] }

interface AttrRef {
  readonly scope: 'R' | 'P'
  readonly key: string
}

const ATTR_RE = /^([RP])\.attr\.([A-Za-z_][A-Za-z0-9_]*)$/

const parseAttrRef = (text: string): AttrRef => {
  const m = ATTR_RE.exec(text.trim())
  if (!m) throw new Error(`cel-mini: not an attribute reference: ${text}`)
  return { scope: m[1] as 'R' | 'P', key: m[2] as string }
}

const parseStringLiteral = (text: string): string => {
  const t = text.trim()
  const first = t[0]
  if ((first === "'" || first === '"') && t.endsWith(first) && t.length >= 2) {
    return t.slice(1, -1)
  }
  throw new Error(`cel-mini: expected string literal, got: ${text}`)
}

const parseList = (text: string): readonly string[] => {
  const t = text.trim()
  if (!t.startsWith('[') || !t.endsWith(']')) {
    throw new Error(`cel-mini: expected list, got: ${text}`)
  }
  const inner = t.slice(1, -1).trim()
  if (inner.length === 0) return []
  const parts = splitTopLevel(inner, ',')
  return parts.map((p) => parseStringLiteral(p))
}

const splitTopLevel = (text: string, sep: string): string[] => {
  const out: string[] = []
  let depth = 0
  let inStr: string | null = null
  let buf = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string
    if (inStr) {
      buf += c
      if (c === inStr) inStr = null
      continue
    }
    if (c === "'" || c === '"') {
      inStr = c
      buf += c
      continue
    }
    if (c === '[' || c === '(') depth++
    else if (c === ']' || c === ')') depth--
    if (depth === 0 && text.startsWith(sep, i)) {
      out.push(buf)
      buf = ''
      i += sep.length - 1
      continue
    }
    buf += c
  }
  out.push(buf)
  return out.map((s) => s.trim()).filter((s) => s.length > 0)
}

const parseClause = (text: string): Clause => {
  const t = text.trim()
  const inIdx = findOperator(t, ' in ')
  if (inIdx >= 0) {
    const lhs = parseAttrRef(t.slice(0, inIdx))
    const list = parseList(t.slice(inIdx + 4))
    return { kind: 'in', lhs, list }
  }
  const neIdx = findOperator(t, '!=')
  if (neIdx >= 0) {
    const lhs = parseAttrRef(t.slice(0, neIdx))
    const literal = parseStringLiteral(t.slice(neIdx + 2))
    return { kind: 'ne', lhs, literal }
  }
  const eqIdx = findOperator(t, '==')
  if (eqIdx >= 0) {
    const lhs = parseAttrRef(t.slice(0, eqIdx))
    const literal = parseStringLiteral(t.slice(eqIdx + 2))
    return { kind: 'eq', lhs, literal }
  }
  throw new Error(`cel-mini: unrecognized clause: ${text}`)
}

const findOperator = (text: string, op: string): number => {
  let inStr: string | null = null
  let depth = 0
  for (let i = 0; i <= text.length - op.length; i++) {
    const c = text[i] as string
    if (inStr) {
      if (c === inStr) inStr = null
      continue
    }
    if (c === "'" || c === '"') {
      inStr = c
      continue
    }
    if (c === '[' || c === '(') depth++
    else if (c === ']' || c === ')') depth--
    if (depth === 0 && text.startsWith(op, i)) return i
  }
  return -1
}

const evalClause = (clause: Clause, b: CelBindings): boolean => {
  const scopeObj = clause.lhs.scope === 'R' ? b.R.attr : b.P.attr
  const value = scopeObj[clause.lhs.key]
  if (value === undefined) return false
  if (clause.kind === 'eq') return value === clause.literal
  if (clause.kind === 'ne') return value !== clause.literal
  return clause.list.includes(value as string)
}

export const evaluateCel = (expr: string, bindings: CelBindings): boolean => {
  const orParts = splitTopLevel(expr, '||')
  if (orParts.length > 1) {
    return orParts.some((p) => evaluateCel(p, bindings))
  }
  const andParts = splitTopLevel(expr, '&&')
  if (andParts.length > 1) {
    return andParts.every((p) => evaluateCel(p, bindings))
  }
  return evalClause(parseClause(expr), bindings)
}
