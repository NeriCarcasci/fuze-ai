import { describe, it, expect, vi, afterEach } from 'vitest'
import { DaemonService } from '../src/services/daemon-service.js'
import type { ToolConfig } from '../src/services/types.js'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('DaemonService', () => {
  it('reconnect delays double as 100, 200, 400, 800', () => {
    const service = new DaemonService('\\\\.\\pipe\\fuze-daemon-test')
    const internal = service as unknown as {
      _scheduleReconnect: () => void
      _closed: boolean
    }
    internal._closed = false

    const delays: number[] = []
    const timeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(((handler: TimerHandler, timeout?: number) => {
        delays.push(Number(timeout ?? 0))
        return 1 as unknown as ReturnType<typeof setTimeout>
      }) as typeof setTimeout)

    internal._scheduleReconnect()
    internal._scheduleReconnect()
    internal._scheduleReconnect()
    internal._scheduleReconnect()

    timeoutSpy.mockRestore()
    expect(delays.slice(0, 4)).toEqual([100, 200, 400, 800])
  })

  it('resolves pending config with empty payload on parse error', () => {
    vi.useFakeTimers()

    const service = new DaemonService('\\\\.\\pipe\\fuze-daemon-test')
    const internal = service as unknown as {
      _onMessage: (line: string) => void
      _pendingConfig: {
        resolve: (tools: Record<string, ToolConfig>) => void
        reject: (err: Error) => void
        timer: ReturnType<typeof setTimeout>
      } | null
    }

    const resolvedValues: Array<Record<string, ToolConfig>> = []
    const timer = setTimeout(() => undefined, 5000)
    internal._pendingConfig = {
      resolve: (tools) => {
        resolvedValues.push(tools)
      },
      reject: () => undefined,
      timer,
    }

    internal._onMessage('{not-json')

    expect(resolvedValues).toEqual([{}])
    expect(internal._pendingConfig).toBeNull()
  })
})