import type { GuardOptions } from './types.js'
import { runDecoratedCall, isAlreadyDecorated } from './decorators-internal.js'

type AnyObj = Record<string | symbol, unknown>

const SKIP_KEYS = new Set<string | symbol>(['then', 'constructor'])

function shouldSkip(key: string | symbol): boolean {
  if (typeof key === 'symbol') return true
  if (SKIP_KEYS.has(key)) return true
  return false
}

// guardAll wraps an object's external method calls in a Proxy. Internal
// `this.foo()` calls from inside a wrapped method run on the original
// receiver and pass through unwrapped — by design. If you want every
// call (internal too) to be guarded, decorate the class with @guarded.
export function guardAll<T extends object>(
  target: T,
  perMethodOptions?: Partial<Record<keyof T, GuardOptions>>,
): T {
  const cache = new Map<string | symbol, unknown>()
  return new Proxy(target as AnyObj, {
    get(obj, key) {
      const value = obj[key]
      if (typeof value !== 'function') return value
      if (shouldSkip(key)) return value
      if (isAlreadyDecorated(value)) return value

      const cached = cache.get(key)
      if (cached) return cached

      const methodName = typeof key === 'symbol' ? key.description ?? 'anonymous' : key
      const original = value as (this: unknown, ...args: unknown[]) => unknown
      const opts = perMethodOptions?.[key as keyof T]

      const wrapped = function (this: unknown, ...args: unknown[]): unknown {
        // Bind to the original target, not the Proxy, so inner this.foo()
        // calls don't loop back through the Proxy.
        return runDecoratedCall(original, target, args, methodName, opts)
      }
      Object.defineProperty(wrapped, 'name', { value: methodName, configurable: true })
      cache.set(key, wrapped)
      return wrapped
    },
  }) as T
}
