import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { AuditStore } from '../src/audit-store.js'
import { AlertManager } from '../src/alert-manager.js'
import { CompensationEngine } from '../src/compensation/compensation-engine.js'

// ── Helpers ────────────────────────────────────────────────────────────────────

function tmpDb(): string {
  return path.join(os.tmpdir(), `fuze-comp-test-${Date.now()}-${randomUUID().slice(0, 6)}.sqlite`)
}

async function makeStore(dbPath: string): Promise<AuditStore> {
  const store = new AuditStore(dbPath)
  await store.init()
  return store
}

async function insertSideEffectRun(
  store: AuditStore,
  runId: string,
  toolNames: string[],
  hasSideEffect = true,
): Promise<string[]> {
  await store.insertRun({
    runId, agentId: 'agent-1', agentVersion: '1.0',
    modelProvider: 'openai', modelName: 'gpt-4',
    status: 'completed', startedAt: new Date().toISOString(),
    totalTokensIn: 0, totalTokensOut: 0,
    totalSteps: toolNames.length, configJson: '{}',
  })

  const stepIds: string[] = []
  for (let i = 0; i < toolNames.length; i++) {
    const stepId = randomUUID()
    stepIds.push(stepId)
    await store.insertStep({
      stepId, runId, stepNumber: i + 1,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      toolName: toolNames[i],
      argsHash: 'abc123',
      hasSideEffect: hasSideEffect ? 1 : 0,
      tokensIn: 10, tokensOut: 20,
      latencyMs: 100, error: null,
    })
  }
  return stepIds
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('CompensationEngine', () => {
  const dbs: string[] = []

  afterEach(() => {
    for (const db of dbs) {
      try { fs.unlinkSync(db) } catch { /* ignore */ }
    }
    dbs.length = 0
  })

  async function makeEngine(store: AuditStore) {
    const alertManager = new AlertManager({ dedupWindowMs: 0 })
    return new CompensationEngine(store, alertManager)
  }

  it('3 side-effect steps → 3 CompensationRecords in reverse order', async () => {
    const db = tmpDb(); dbs.push(db)
    const store = await makeStore(db)
    const engine = await makeEngine(store)
    const runId = randomUUID()

    const stepIds = await insertSideEffectRun(store, runId, ['tool-a', 'tool-b', 'tool-c'])
    const compensated: string[] = []

    engine.registerCompensation(runId, stepIds[0], 'tool-a', async () => { compensated.push('a') })
    engine.registerCompensation(runId, stepIds[1], 'tool-b', async () => { compensated.push('b') })
    engine.registerCompensation(runId, stepIds[2], 'tool-c', async () => { compensated.push('c') })

    const result = await engine.rollback(runId, stepIds[2])

    expect(result.compensated).toBe(3)
    expect(result.failed).toBe(0)
    expect(result.noCompensation).toBe(0)
    expect(result.details).toHaveLength(3)

    // Compensations ran in reverse order (LIFO)
    expect(compensated).toEqual(['c', 'b', 'a'])

    // All records have succeeded status
    expect(result.details.every((r) => r.compensationStatus === 'succeeded')).toBe(true)

    // Records are for the correct run
    expect(result.details.every((r) => r.runId === runId)).toBe(true)
  })

  it('failed compensation → status "failed", error recorded, alert emitted', async () => {
    const db = tmpDb(); dbs.push(db)
    const store = await makeStore(db)
    const alertManager = new AlertManager({ dedupWindowMs: 0 })
    const engine = new CompensationEngine(store, alertManager)
    const runId = randomUUID()

    const stepIds = await insertSideEffectRun(store, runId, ['failing-tool'])
    engine.registerCompensation(runId, stepIds[0], 'failing-tool', async () => {
      throw new Error('DB connection lost')
    })

    const result = await engine.rollback(runId, stepIds[0])

    expect(result.failed).toBe(1)
    expect(result.compensated).toBe(0)

    const record = result.details[0]
    expect(record.compensationStatus).toBe('failed')
    expect(record.compensationError).toContain('DB connection lost')

    // Alert was emitted
    expect(alertManager.getHistory(10).some((a) => a.type === 'compensation_failed')).toBe(true)
  })

  it('non-side-effect steps → counted as skipped, not compensated', async () => {
    const db = tmpDb(); dbs.push(db)
    const store = await makeStore(db)
    const engine = await makeEngine(store)
    const runId = randomUUID()

    // Insert 3 steps, none with side effects
    const stepIds = await insertSideEffectRun(store, runId, ['read', 'search', 'summarise'], false)

    const result = await engine.rollback(runId, stepIds[2])

    // No side-effect steps → no compensations needed
    expect(result.compensated).toBe(0)
    expect(result.details).toHaveLength(0)
    expect(result.totalSteps).toBe(3)
    expect(result.skipped).toBe(3)
  })

  it('no registered compensation → "no_compensation", escalated', async () => {
    const db = tmpDb(); dbs.push(db)
    const store = await makeStore(db)
    const alertManager = new AlertManager({ dedupWindowMs: 0 })
    const engine = new CompensationEngine(store, alertManager)
    const runId = randomUUID()

    const stepIds = await insertSideEffectRun(store, runId, ['side-effect-tool'])
    // Do NOT register a compensation handler

    const result = await engine.rollback(runId, stepIds[0])

    expect(result.noCompensation).toBe(1)
    expect(result.compensated).toBe(0)

    const record = result.details[0]
    expect(record.compensationStatus).toBe('no_compensation')
    expect(record.escalated).toBe(true)

    // Escalation alert emitted
    expect(alertManager.getHistory(10).some((a) => a.type === 'compensation_escalated')).toBe(true)
  })

  it('rollback of already-rolled-back run is idempotent', async () => {
    const db = tmpDb(); dbs.push(db)
    const store = await makeStore(db)
    const engine = await makeEngine(store)
    const runId = randomUUID()

    const stepIds = await insertSideEffectRun(store, runId, ['tool-a'])
    let callCount = 0
    engine.registerCompensation(runId, stepIds[0], 'tool-a', async () => { callCount++ })

    const result1 = await engine.rollback(runId, stepIds[0])
    expect(result1.compensated).toBe(1)
    expect(callCount).toBe(1)

    // Re-register and rollback again — should skip already-succeeded records
    engine.registerCompensation(runId, stepIds[0], 'tool-a', async () => { callCount++ })
    const result2 = await engine.rollback(runId, stepIds[0])
    expect(callCount).toBe(1) // Handler NOT called again
    expect(result2.skipped).toBe(1)
  })

  it('getCompensationStatus returns all stored records for a run', async () => {
    const db = tmpDb(); dbs.push(db)
    const store = await makeStore(db)
    const engine = await makeEngine(store)
    const runId = randomUUID()

    const stepIds = await insertSideEffectRun(store, runId, ['tool-a', 'tool-b'])
    engine.registerCompensation(runId, stepIds[0], 'tool-a', async () => {})
    engine.registerCompensation(runId, stepIds[1], 'tool-b', async () => {})

    await engine.rollback(runId, stepIds[1])

    const status = await engine.getCompensationStatus(runId)
    expect(status).toHaveLength(2)
    expect(status.every((r) => r.runId === runId)).toBe(true)
  })

  it('rollback only affects steps up to and including fromStepId', async () => {
    const db = tmpDb(); dbs.push(db)
    const store = await makeStore(db)
    const engine = await makeEngine(store)
    const runId = randomUUID()

    const stepIds = await insertSideEffectRun(store, runId, ['tool-a', 'tool-b', 'tool-c'])
    const compensated: string[] = []
    engine.registerCompensation(runId, stepIds[0], 'tool-a', async () => { compensated.push('a') })
    engine.registerCompensation(runId, stepIds[1], 'tool-b', async () => { compensated.push('b') })
    engine.registerCompensation(runId, stepIds[2], 'tool-c', async () => { compensated.push('c') })

    // Only rollback up to step-2 (index 1)
    const result = await engine.rollback(runId, stepIds[1])

    expect(result.compensated).toBe(2)
    // tool-c (step 3) was not in scope
    expect(compensated).not.toContain('c')
    expect(compensated.sort()).toEqual(['a', 'b'])
  })

  it('compensationEndedAt is after handler execution', async () => {
    const db = tmpDb(); dbs.push(db)
    const store = await makeStore(db)
    const engine = await makeEngine(store)
    const runId = randomUUID()

    const stepIds = await insertSideEffectRun(store, runId, ['slow-tool'])
    const beforeHandler = new Date().toISOString()

    engine.registerCompensation(runId, stepIds[0], 'slow-tool', async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    const result = await engine.rollback(runId, stepIds[0])
    const record = result.details[0]
    expect(record.compensationStatus).toBe('succeeded')
    expect(record.compensationEndedAt! >= beforeHandler).toBe(true)
    expect(record.compensationEndedAt! >= record.compensationStartedAt!).toBe(true)
  })
})
