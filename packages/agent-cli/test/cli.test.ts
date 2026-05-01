import { describe, expect, it, vi } from 'vitest'
import { dispatch } from '../src/cli.js'
import type { ApiClient } from '../src/api-client.js'

const fakeClient = (overrides: Partial<ApiClient> = {}): ApiClient =>
  ({
    health: vi.fn(async () => ({ ok: true })),
    auditQuery: vi.fn(async () => ({ records: [] })),
    runReplay: vi.fn(async () => ({ runId: 'r', steps: [] })),
    runVerify: vi.fn(async () => ({ runId: 'r', chainValid: true, transparencyAnchor: null })),
    approve: vi.fn(async () => ({ runId: 'r', accepted: true })),
    ...overrides,
  }) as unknown as ApiClient

describe('cli dispatch', () => {
  it('prints help with no args', async () => {
    const r = await dispatch([])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('Usage')
  })

  it('dispatches health command via client', async () => {
    const client = fakeClient()
    const r = await dispatch(['health', '--json'], { client })
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('"ok"')
  })

  it('parses audit query options and forwards them', async () => {
    const auditQuery = vi.fn(async () => ({ spans: [] }))
    const client = fakeClient({ auditQuery } as Partial<ApiClient>)
    const r = await dispatch(
      ['audit', 'query', '--subject', 'h', '--since', '2026-01-01'],
      { client },
    )
    expect(r.exitCode).toBe(0)
    expect(auditQuery).toHaveBeenCalledWith({
      subject: 'h',
      since: '2026-01-01',
    })
  })

  it('reports a helpful error when approve action is invalid', async () => {
    const client = fakeClient()
    const r = await dispatch(
      ['approve', 'r1', '--action', 'bogus', '--rationale', 'why', '--overseer', 'o'],
      { client },
    )
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toContain('--action must be one of')
  })

  it('rejects unknown command', async () => {
    const r = await dispatch(['bogus'])
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toContain('unknown command')
  })

  it('verify exits 2 when chain is invalid', async () => {
    const client = fakeClient({
      runVerify: vi.fn(async () => ({ runId: 'r', chainValid: false, transparencyAnchor: null })),
    } as Partial<ApiClient>)
    const r = await dispatch(['audit', 'verify', 'r1'], { client })
    expect(r.exitCode).toBe(2)
  })
})
