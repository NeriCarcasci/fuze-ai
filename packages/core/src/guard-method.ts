import type { GuardOptions } from './types.js'
import { runDecoratedCall, isAlreadyDecorated, markDecorated } from './decorators-internal.js'

type AnyMethod = (this: unknown, ...args: unknown[]) => unknown

interface MethodDecoratorContext {
  kind: 'method'
  name: string | symbol
  static: boolean
  private: boolean
}

function isMethodContext(value: unknown): value is MethodDecoratorContext {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'method'
  )
}

function decorateMethod(target: AnyMethod, ctx: MethodDecoratorContext, options?: GuardOptions): AnyMethod {
  if (isAlreadyDecorated(target)) return target
  const methodName = String(ctx.name)
  const replacement = function (this: unknown, ...args: unknown[]): unknown {
    return runDecoratedCall(target, this, args, methodName, options)
  } as AnyMethod
  Object.defineProperty(replacement, 'name', { value: methodName, configurable: true })
  return markDecorated(replacement)
}

// `@guardMethod` (bare) and `@guardMethod({...})` (factory) both supported.
// Bare form: TS calls guardMethod(target, ctx) — returns the replacement directly.
// Factory form: TS calls guardMethod(options) — returns a decorator that does the same.
export function guardMethod(target: AnyMethod, ctx: MethodDecoratorContext): AnyMethod
export function guardMethod(options: GuardOptions): (target: AnyMethod, ctx: MethodDecoratorContext) => AnyMethod
export function guardMethod(
  arg1: AnyMethod | GuardOptions,
  arg2?: MethodDecoratorContext,
): AnyMethod | ((target: AnyMethod, ctx: MethodDecoratorContext) => AnyMethod) {
  if (typeof arg1 === 'function' && arg2 !== undefined && isMethodContext(arg2)) {
    return decorateMethod(arg1, arg2)
  }
  const options = arg1 as GuardOptions
  return (target: AnyMethod, ctx: MethodDecoratorContext): AnyMethod => decorateMethod(target, ctx, options)
}
