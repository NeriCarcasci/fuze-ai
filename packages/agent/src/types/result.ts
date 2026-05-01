export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E }

export const Ok = <T>(value: T): Result<T, never> => ({ ok: true, value })
export const Err = <E>(error: E): Result<never, E> => ({ ok: false, error })

export interface Retryable {
  readonly retryable: true
  readonly reason: string
  readonly cause?: unknown
}

export const Retry = (reason: string, cause?: unknown): Retryable => ({
  retryable: true,
  reason,
  ...(cause === undefined ? {} : { cause }),
})

export const isRetryable = (e: unknown): e is Retryable =>
  typeof e === 'object' && e !== null && (e as { retryable?: unknown }).retryable === true
