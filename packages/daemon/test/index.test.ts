import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('daemon index bootstrap', () => {
  it('logs and exits when audit store init fails', async () => {
    vi.doMock('../src/config.js', () => ({
      loadDaemonConfig: () => ({
        socketPath: 'invalid-socket',
        apiPort: 17999,
        storagePath: 'invalid-storage.sqlite',
        retentionDays: 30,
        budget: {
          orgDailyTokenBudget: 100000,
          perAgentDailyTokenBudget: 20000,
          alertThreshold: 0.8,
        },
        alerts: {
          dedupWindowMs: 0,
          webhookUrls: [],
        },
      }),
    }))

    vi.doMock('../src/audit-store.js', () => ({
      AuditStore: class {
        constructor(_dbPath: string) {}
        async init(): Promise<void> {
          throw new Error('init exploded')
        }
      },
    }))

    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process_exit_${code ?? 0}`)
    }) as never)

    const { startDaemon } = await import('../src/index.js')

    await expect(startDaemon([])).rejects.toThrow('process_exit_1')
    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to initialize audit store'))
  })
})