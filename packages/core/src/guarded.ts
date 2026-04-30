import type { GuardOptions } from './types.js'
import { runDecoratedCall, isAlreadyDecorated, markDecorated } from './decorators-internal.js'

type Constructor = new (...args: unknown[]) => object

interface ClassContext {
  kind: 'class'
  name: string | undefined
}

function isClassContext(value: unknown): value is ClassContext {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'class'
  )
}

function wrapPrototypeMethods<T extends Constructor>(cls: T, options?: GuardOptions): T {
  const proto = cls.prototype as Record<string | symbol, unknown>
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === 'constructor') continue
    const descriptor = Object.getOwnPropertyDescriptor(proto, name)
    if (!descriptor) continue
    if (descriptor.get || descriptor.set) continue
    const value = descriptor.value
    if (typeof value !== 'function') continue
    if (isAlreadyDecorated(value)) continue

    const original = value as (this: unknown, ...args: unknown[]) => unknown
    const replacement = function (this: unknown, ...args: unknown[]): unknown {
      return runDecoratedCall(original, this, args, name, options)
    }
    Object.defineProperty(replacement, 'name', { value: name, configurable: true })
    markDecorated(replacement)
    Object.defineProperty(proto, name, {
      value: replacement,
      writable: descriptor.writable ?? true,
      enumerable: descriptor.enumerable ?? false,
      configurable: descriptor.configurable ?? true,
    })
  }
  return cls
}

// `@guarded` (bare) and `@guarded({...})` (factory) both supported.
// Walks own prototype methods, wraps each. Inherited methods are not touched.
// Static methods, getters, and setters are not touched.
// Methods already decorated with `@guardMethod` are skipped (idempotent).
export function guarded<T extends Constructor>(target: T, ctx: ClassContext): T
export function guarded(options: GuardOptions): <T extends Constructor>(target: T, ctx: ClassContext) => T
export function guarded<T extends Constructor>(
  arg1: T | GuardOptions,
  arg2?: ClassContext,
): T | (<U extends Constructor>(target: U, ctx: ClassContext) => U) {
  if (typeof arg1 === 'function' && arg2 !== undefined && isClassContext(arg2)) {
    return wrapPrototypeMethods(arg1)
  }
  const options = arg1 as GuardOptions
  return <U extends Constructor>(target: U, _ctx: ClassContext): U => wrapPrototypeMethods(target, options)
}
