import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AuditStore } from '../src/audit-store.js'
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs'

function tempDb(): string {
  return path.join(os.tmpdir(), `fuze-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
}

describe('AuditStore', () => {
  let store: AuditStore
  let dbPath: string

  beforeEach(async () => {
    dbPath = tempDb()
    store = new AuditStore(dbPath)
    await store.init()
  })

  afterEach(async () => {
    await store.close()
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
  })

  it('inserts and retrieves a run', async () => {
    await store.insertRun({
      runId: 'r1', agentId: 'a1', agentVersion: '1.0', modelProvider: 'openai',
      modelName: 'gpt-4o', status: 'running', startedAt: new Date().toISOString(),
      totalCost: 0, totalTokensIn: 0, totalTokensOut: 0, totalSteps: 0,
      configJson: '{}',
    })
    const run = await store.getRun('r1')
    expect(run).not.toBeNull()
    expect(run?.agentId).toBe('a1')
    expect(run?.hash).toBeTruthy()
  })

  it('inserts and retrieves steps', async () => {
    await store.insertRun({
      runId: 'r1', agentId: 'a1', agentVersion: '', modelProvider: '', modelName: '',
      status: 'running', startedAt: new Date().toISOString(),
      totalCost: 0, totalTokensIn: 0, totalTokensOut: 0, totalSteps: 0, configJson: '{}',
    })
    await store.insertStep({
      stepId: 's1', runId: 'r1', stepNumber: 1, startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(), toolName: 'myTool', argsHash: 'abc123',
      hasSideEffect: 0, costUsd: 0.01, tokensIn: 100, tokensOut: 50, latencyMs: 200, error: null,
    })
    const steps = await store.getRunSteps('r1')
    expect(steps).toHaveLength(1)
    expect(steps[0].toolName).toBe('myTool')
  })

  it('inserts and retrieves guard events', async () => {
    await store.insertRun({
      runId: 'r1', agentId: 'a1', agentVersion: '', modelProvider: '', modelName: '',
      status: 'running', startedAt: new Date().toISOString(),
      totalCost: 0, totalTokensIn: 0, totalTokensOut: 0, totalSteps: 0, configJson: '{}',
    })
    await store.insertGuardEvent({
      eventId: 'e1', runId: 'r1', timestamp: new Date().toISOString(),
      eventType: 'loop_detected', severity: 'warning', detailsJson: '{}',
    })
    const events = await store.getRunGuardEvents('r1')
    expect(events).toHaveLength(1)
    expect(events[0].eventType).toBe('loop_detected')
  })

  it('listRuns filters by agentId', async () => {
    for (const id of ['r1', 'r2']) {
      await store.insertRun({
        runId: id, agentId: id === 'r1' ? 'agent-x' : 'agent-y',
        agentVersion: '', modelProvider: '', modelName: '',
        status: 'running', startedAt: new Date().toISOString(),
        totalCost: 0, totalTokensIn: 0, totalTokensOut: 0, totalSteps: 0, configJson: '{}',
      })
    }
    const runs = await store.listRuns({ agentId: 'agent-x' })
    expect(runs).toHaveLength(1)
    expect(runs[0].agentId).toBe('agent-x')
  })

  it('updateRunStatus updates status and ended_at', async () => {
    await store.insertRun({
      runId: 'r1', agentId: 'a1', agentVersion: '', modelProvider: '', modelName: '',
      status: 'running', startedAt: new Date().toISOString(),
      totalCost: 0, totalTokensIn: 0, totalTokensOut: 0, totalSteps: 0, configJson: '{}',
    })
    await store.updateRunStatus('r1', 'completed', 0.5)
    const run = await store.getRun('r1')
    expect(run?.status).toBe('completed')
    expect(run?.endedAt).toBeTruthy()
  })

  it('verifyHashChain returns valid for an empty store', async () => {
    const result = await store.verifyHashChain()
    expect(result.valid).toBe(true)
  })

  it('verifyHashChain validates multiple chained runs', async () => {
    for (let i = 0; i < 3; i++) {
      await store.insertRun({
        runId: `r${i}`, agentId: 'a1', agentVersion: '', modelProvider: '', modelName: '',
        status: 'running', startedAt: new Date().toISOString(),
        totalCost: 0, totalTokensIn: 0, totalTokensOut: 0, totalSteps: 0, configJson: '{}',
      })
    }
    const result = await store.verifyHashChain()
    expect(result.valid).toBe(true)
  })

  it('purgeOlderThan removes old runs and associated data', async () => {
    const oldDate = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString()
    await store.insertRun({
      runId: 'old-run', agentId: 'a1', agentVersion: '', modelProvider: '', modelName: '',
      status: 'completed', startedAt: oldDate,
      totalCost: 0, totalTokensIn: 0, totalTokensOut: 0, totalSteps: 0, configJson: '{}',
    })
    const deleted = await store.purgeOlderThan(90)
    expect(deleted).toBe(1)
    const run = await store.getRun('old-run')
    expect(run).toBeNull()
  })

  it('countRuns returns correct count', async () => {
    for (let i = 0; i < 3; i++) {
      await store.insertRun({
        runId: `r${i}`, agentId: 'a1', agentVersion: '', modelProvider: '', modelName: '',
        status: 'running', startedAt: new Date().toISOString(),
        totalCost: 0, totalTokensIn: 0, totalTokensOut: 0, totalSteps: 0, configJson: '{}',
      })
    }
    expect(await store.countRuns()).toBe(3)
  })

  it('purgeOlderThan removes compensation_records and idempotency_keys for purged runs', async () => {
    const oldDate = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString()
    await store.insertRun({
      runId: 'old-run-2', agentId: 'a1', agentVersion: '', modelProvider: '', modelName: '',
      status: 'completed', startedAt: oldDate,
      totalCost: 0, totalTokensIn: 0, totalTokensOut: 0, totalSteps: 1, configJson: '{}',
    })
    await store.insertStep({
      stepId: 's1', runId: 'old-run-2', stepNumber: 1, startedAt: oldDate,
      endedAt: oldDate, toolName: 'tool-a', argsHash: 'abc',
      hasSideEffect: 1, costUsd: 0, tokensIn: 0, tokensOut: 0, latencyMs: 0, error: null,
    })
    await store.insertCompensationRecord({
      compensationId: 'comp-1', runId: 'old-run-2', stepId: 's1', toolName: 'tool-a',
      originalResultJson: null, compensationStatus: 'succeeded',
      compensationStartedAt: oldDate, compensationEndedAt: oldDate,
      compensationError: null, escalated: false,
    })
    await store.insertIdempotencyKey({
      keyHash: 'key-1', runId: 'old-run-2', stepId: 's1', toolName: 'tool-a',
      argsHash: 'abc', createdAt: oldDate, resultJson: null,
    })

    const deleted = await store.purgeOlderThan(90)
    expect(deleted).toBe(1)

    const compensation = await store.getCompensationByRun('old-run-2')
    expect(compensation).toHaveLength(0)

    const key = await store.getIdempotencyKey('key-1')
    expect(key).toBeNull()
  })

  it('verifyHashChain validates compensation_records chain', async () => {
    await store.insertRun({
      runId: 'r-chain', agentId: 'a1', agentVersion: '', modelProvider: '', modelName: '',
      status: 'completed', startedAt: new Date().toISOString(),
      totalCost: 0, totalTokensIn: 0, totalTokensOut: 0, totalSteps: 1, configJson: '{}',
    })
    await store.insertCompensationRecord({
      compensationId: 'comp-a', runId: 'r-chain', stepId: 's1', toolName: 'tool-a',
      originalResultJson: null, compensationStatus: 'succeeded',
      compensationStartedAt: new Date().toISOString(),
      compensationEndedAt: new Date().toISOString(),
      compensationError: null, escalated: false,
    })
    await store.insertCompensationRecord({
      compensationId: 'comp-b', runId: 'r-chain', stepId: 's2', toolName: 'tool-b',
      originalResultJson: null, compensationStatus: 'failed',
      compensationStartedAt: new Date().toISOString(),
      compensationEndedAt: new Date().toISOString(),
      compensationError: 'timeout', escalated: true,
    })

    const result = await store.verifyHashChain()
    expect(result.valid).toBe(true)
  })

  it('purgeOlderThan is atomic and rolls back when a delete fails', async () => {
    const oldDate = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString()
    await store.insertRun({
      runId: 'old-run-atomic', agentId: 'a1', agentVersion: '', modelProvider: '', modelName: '',
      status: 'completed', startedAt: oldDate,
      totalCost: 0, totalTokensIn: 0, totalTokensOut: 0, totalSteps: 1, configJson: '{}',
    })
    await store.insertStep({
      stepId: 's-atomic', runId: 'old-run-atomic', stepNumber: 1, startedAt: oldDate,
      endedAt: oldDate, toolName: 'tool-atomic', argsHash: 'atomic',
      hasSideEffect: 1, costUsd: 0, tokensIn: 0, tokensOut: 0, latencyMs: 0, error: null,
    })
    await store.insertGuardEvent({
      eventId: 'e-atomic', runId: 'old-run-atomic', timestamp: oldDate,
      eventType: 'loop_detected', severity: 'warning', detailsJson: '{}',
    })
    await store.insertCompensationRecord({
      compensationId: 'comp-atomic', runId: 'old-run-atomic', stepId: 's-atomic', toolName: 'tool-atomic',
      originalResultJson: null, compensationStatus: 'succeeded',
      compensationStartedAt: oldDate, compensationEndedAt: oldDate, compensationError: null, escalated: false,
    })
    await store.insertIdempotencyKey({
      keyHash: 'key-atomic', runId: 'old-run-atomic', stepId: 's-atomic',
      toolName: 'tool-atomic', argsHash: 'atomic', createdAt: oldDate, resultJson: '{"ok":true}',
    })

    const internalDb = (store as unknown as { db: { prepare: (sql: string) => unknown } }).db
    const originalPrepare = internalDb.prepare.bind(internalDb) as (sql: string) => unknown
    const prepareSpy = vi.spyOn(internalDb, 'prepare').mockImplementation((sql: string) => {
      if (sql.includes('DELETE FROM idempotency_keys')) {
        throw new Error('simulated delete failure')
      }
      return originalPrepare(sql)
    })

    await expect(store.purgeOlderThan(90)).rejects.toThrow('simulated delete failure')
    prepareSpy.mockRestore()

    expect(await store.getRun('old-run-atomic')).not.toBeNull()
    expect((await store.getRunSteps('old-run-atomic')).length).toBe(1)
    expect((await store.getRunGuardEvents('old-run-atomic')).length).toBe(1)
    expect((await store.getCompensationByRun('old-run-atomic')).length).toBe(1)
    expect(await store.getIdempotencyKey('key-atomic')).not.toBeNull()
  })
})
