import { describe, expect, it } from 'vitest'

interface UpstreamBashLoggerLike {
  info(message: string, data?: Record<string, unknown>): void
  debug(message: string, data?: Record<string, unknown>): void
}

const importAdapter = async (): Promise<{
  adaptLogger: (
    fn: (event: { command: string; exitCode: number; durationMs: number }) => void,
  ) => UpstreamBashLoggerLike
}> => {
  const mod = (await import('../src/real-factory.js')) as unknown as {
    __testing__?: {
      adaptLogger?: (
        fn: (event: { command: string; exitCode: number; durationMs: number }) => void,
      ) => UpstreamBashLoggerLike
    }
  }
  if (!mod.__testing__?.adaptLogger) {
    throw new Error('adaptLogger not exported via __testing__ — see real-factory.ts')
  }
  return { adaptLogger: mod.__testing__.adaptLogger }
}

describe('RealBashFactory adaptLogger', () => {
  it('forwards info events with full payload to the user-supplied function', async () => {
    const { adaptLogger } = await importAdapter()
    const seen: { command: string; exitCode: number; durationMs: number }[] = []
    const upstream = adaptLogger((e) => seen.push(e))
    upstream.info('exec-completed', { command: 'echo hi', exitCode: 0, durationMs: 12 })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toEqual({ command: 'echo hi', exitCode: 0, durationMs: 12 })
  })

  it('drops info events that lack exitCode or durationMs (not exec-completion)', async () => {
    const { adaptLogger } = await importAdapter()
    const seen: unknown[] = []
    const upstream = adaptLogger((e) => seen.push(e))
    upstream.info('partial', { command: 'echo' })
    upstream.info('partial', { command: 'echo', exitCode: 0 })
    upstream.info('no-data')
    expect(seen).toHaveLength(0)
  })

  it('debug events are silently discarded (documented behavior)', async () => {
    const { adaptLogger } = await importAdapter()
    const seen: unknown[] = []
    const upstream = adaptLogger((e) => seen.push(e))
    upstream.debug('something noisy', { command: 'echo', exitCode: 0, durationMs: 1 })
    expect(seen).toHaveLength(0)
  })
})
