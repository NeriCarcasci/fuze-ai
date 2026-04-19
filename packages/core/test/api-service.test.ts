import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiService } from '../src/services/api-service.js'
import type { StepCheckData, StepEndData } from '../src/services/types.js'

const STEP_CHECK: StepCheckData = {
  stepId: 'step-1',
  stepNumber: 1,
  toolName: 'search',
  argsHash: 'abc123',
  sideEffect: false,
}

const STEP_END: StepEndData = {
  toolName: 'search',
  stepNumber: 1,
  argsHash: 'abc123',
  hasSideEffect: false,
  tokensIn: 100,
  tokensOut: 50,
  latencyMs: 20,
  error: null,
}

const ORIGINAL_FETCH = globalThis.fetch
const ORIGINAL_ONCE = process.once
const ORIGINAL_OFF = process.off

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  globalThis.fetch = ORIGINAL_FETCH
  process.once = ORIGINAL_ONCE
  process.off = ORIGINAL_OFF
})

function mockExitHooks(): void {
  process.once = vi.fn() as unknown as typeof process.once
  process.off = vi.fn() as unknown as typeof process.off
}

function mockResponse(body: unknown = {}, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

describe('ApiService', () => {
  it('batches 10 events into a single POST after flush interval', async () => {
    vi.useFakeTimers()
    mockExitHooks()

    const eventsPayloads: unknown[] = []
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/v1/health')) return mockResponse()
      if (url.endsWith('/v1/tools/config')) return mockResponse({ tools: {} })
      if (url.endsWith('/v1/events')) {
        eventsPayloads.push(JSON.parse(String(init?.body)))
        return mockResponse()
      }
      return mockResponse()
    }) as unknown as typeof fetch

    const service = new ApiService('test-key', {
      endpoint: 'https://example.test',
      flushIntervalMs: 1_000,
    })
    await expect(service.connect()).resolves.toBe(true)

    for (let i = 0; i < 10; i++) {
      await service.sendStepEnd('run-1', `step-${i}`, STEP_END)
    }

    await vi.advanceTimersByTimeAsync(1_001)
    await vi.waitFor(() => {
      expect(eventsPayloads).toHaveLength(1)
    })
    const payload = eventsPayloads[0] as { events: unknown[] }
    expect(payload.events).toHaveLength(10)

    await service.disconnect()
  })

  it('opens circuit breaker after three failed requests and skips the fourth', async () => {
    vi.useFakeTimers()
    mockExitHooks()

    const fetchMock = vi.fn(async () => {
      throw new Error('network down')
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const service = new ApiService('test-key', { endpoint: 'https://example.test' })

    await service.sendStepStart('run-1', STEP_CHECK)
    await service.sendStepStart('run-1', STEP_CHECK)
    await service.sendStepStart('run-1', STEP_CHECK)
    await service.sendStepStart('run-1', STEP_CHECK)

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(service.isConnected()).toBe(false)
  })

  it('recovers circuit breaker after cooldown and successful probe', async () => {
    vi.useFakeTimers()
    mockExitHooks()

    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length <= 3) {
        throw new Error('network down')
      }
      return mockResponse({ decision: 'proceed' })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const service = new ApiService('test-key', { endpoint: 'https://example.test' })

    await service.sendStepStart('run-1', STEP_CHECK)
    await service.sendStepStart('run-1', STEP_CHECK)
    await service.sendStepStart('run-1', STEP_CHECK)
    await service.sendStepStart('run-1', STEP_CHECK)
    expect(fetchMock).toHaveBeenCalledTimes(3)

    await vi.advanceTimersByTimeAsync(60_000)

    await service.sendStepStart('run-1', STEP_CHECK)
    expect(fetchMock).toHaveBeenCalledTimes(4)

    await service.sendStepStart('run-1', STEP_CHECK)
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('flushes pending events on disconnect', async () => {
    vi.useFakeTimers()
    mockExitHooks()

    const eventsPayloads: unknown[] = []
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/v1/health')) return mockResponse()
      if (url.endsWith('/v1/tools/config')) return mockResponse({ tools: {} })
      if (url.endsWith('/v1/events')) {
        eventsPayloads.push(JSON.parse(String(init?.body)))
        return mockResponse()
      }
      return mockResponse()
    }) as unknown as typeof fetch

    const service = new ApiService('test-key', { endpoint: 'https://example.test' })
    await service.connect()

    for (let i = 0; i < 5; i++) {
      await service.sendStepEnd('run-1', `step-${i}`, STEP_END)
    }

    await service.disconnect()

    expect(eventsPayloads).toHaveLength(1)
    const payload = eventsPayloads[0] as { events: unknown[] }
    expect(payload.events).toHaveLength(5)
  })

  it('uses config cache TTL and avoids redundant refreshes within 5 minutes', async () => {
    vi.useFakeTimers()
    mockExitHooks()

    const fetchMock = vi.fn(async (input) => {
      const url = String(input)
      if (url.endsWith('/v1/tools/config')) {
        return mockResponse({
          tools: {
            search: {
              maxRetries: 2,
              maxBudget: 1.0,
              timeout: 5000,
              enabled: true,
              updatedAt: '2026-01-01T00:00:00Z',
            },
          },
        })
      }
      return mockResponse()
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const service = new ApiService('test-key', { endpoint: 'https://example.test' })

    await service.refreshConfig()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    expect(service.getToolConfig('search')).not.toBeNull()
    await service.refreshConfig()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1)
    await service.refreshConfig()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('runs in offline mode with empty API key and performs no HTTP calls', async () => {
    const fetchMock = vi.fn(async () => mockResponse())
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const service = new ApiService('', { endpoint: 'https://example.test' })

    await expect(service.connect()).resolves.toBe(false)
    await service.sendRunStart('run-1', 'agent-1', {})
    await service.sendStepStart('run-1', STEP_CHECK)
    await service.sendStepEnd('run-1', 'step-1', STEP_END)
    await service.sendGuardEvent('run-1', {
      eventType: 'loop_detected',
      severity: 'warning',
      details: { reason: 'test' },
    })
    await service.sendRunEnd('run-1', 'completed', 0.1)
    await service.refreshConfig()
    await service.flush()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(service.getToolConfig('search')).toBeNull()
  })
})
