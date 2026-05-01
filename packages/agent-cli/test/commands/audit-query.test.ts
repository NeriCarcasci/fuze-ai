import { describe, expect, it, vi } from 'vitest'
import { runAuditQueryCommand } from '../../src/commands/audit-query.js'
import type { ApiClient } from '../../src/api-client.js'

const stubClient = (spans: ReadonlyArray<Record<string, unknown>>): ApiClient =>
  ({
    auditQuery: vi.fn(async () => ({ spans })),
  }) as unknown as ApiClient

describe('audit-query command', () => {
  it('errors when subject is missing', async () => {
    const result = await runAuditQueryCommand({
      client: stubClient([]),
      subject: '',
      tenant: '',
    })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('--subject')
  })

  it('returns spans with json mode', async () => {
    const spans = [{ runId: 'r1', span: 'agent.step' }]
    const result = await runAuditQueryCommand({
      client: stubClient(spans),
      subject: 'h',
      tenant: '',
      json: true,
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('"spans"')
    expect(result.stdout).toContain('r1')
  })

  it('returns spans without json mode', async () => {
    const spans = [{ runId: 'r2' }]
    const result = await runAuditQueryCommand({
      client: stubClient(spans),
      subject: 'h',
      tenant: '',
      json: false,
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('r2')
  })
})
