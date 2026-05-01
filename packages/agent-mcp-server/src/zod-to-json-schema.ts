import type { ZodType } from 'zod'

export interface JsonSchema {
  readonly type?: 'object' | 'string' | 'number' | 'boolean' | 'array' | 'null'
  readonly properties?: Readonly<Record<string, JsonSchema>>
  readonly required?: readonly string[]
  readonly items?: JsonSchema
}

interface ZodLikeDef {
  readonly typeName?: string
  readonly innerType?: ZodLike
  readonly type?: ZodLike
}

interface ZodLike {
  readonly _def?: ZodLikeDef
  readonly shape?: Record<string, ZodLike>
  isOptional?(): boolean
}

const isZodLike = (v: unknown): v is ZodLike =>
  typeof v === 'object' && v !== null && '_def' in (v as Record<string, unknown>)

const typeNameOf = (z: ZodLike): string | undefined => z._def?.typeName

const unwrapOptional = (z: ZodLike): ZodLike => {
  if (typeNameOf(z) === 'ZodOptional' && z._def?.innerType) return z._def.innerType
  return z
}

let warn: (msg: string) => void = (msg) => {
  if (typeof process !== 'undefined' && process.stderr && typeof process.stderr.write === 'function') {
    process.stderr.write(`[fuze-mcp-server] ${msg}\n`)
  }
}

export const setZodWarnSink = (fn: (msg: string) => void): void => {
  warn = fn
}

const convertNode = (z: ZodLike): JsonSchema => {
  const inner = unwrapOptional(z)
  const tn = typeNameOf(inner)
  if (tn === 'ZodString') return { type: 'string' }
  if (tn === 'ZodNumber') return { type: 'number' }
  if (tn === 'ZodBoolean') return { type: 'boolean' }
  if (tn === 'ZodObject') return convertObject(inner)
  if (tn === 'ZodArray') {
    const itemDef = inner._def?.type
    if (itemDef && isZodLike(itemDef)) {
      return { type: 'array', items: convertNode(itemDef) }
    }
    return { type: 'array' }
  }
  warn(`zod type ${tn ?? 'unknown'} not supported, emitting {}`)
  return {}
}

const convertObject = (z: ZodLike): JsonSchema => {
  if (typeNameOf(z) !== 'ZodObject' || !z.shape) {
    warn('expected z.object(...), emitting {}')
    return { type: 'object', properties: {}, required: [] }
  }
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []
  for (const [key, raw] of Object.entries(z.shape)) {
    if (!isZodLike(raw)) continue
    properties[key] = convertNode(raw)
    const optional =
      typeof raw.isOptional === 'function' ? raw.isOptional() : typeNameOf(raw) === 'ZodOptional'
    if (!optional) required.push(key)
  }
  return { type: 'object', properties, required }
}

export const zodToJsonSchema = (schema: ZodType<unknown>): JsonSchema => {
  return convertNode(schema as unknown as ZodLike)
}
