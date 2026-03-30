import { createRun } from 'fuze-ai'

const MOCK_DB: Record<string, unknown[]> = {
  previous_reports: [
    { id: 1, topic: 'AI Safety 2025', date: '2025-06-15' },
    { id: 2, topic: 'EU Compliance Readiness', date: '2025-09-01' },
  ],
  stakeholders: [
    { name: 'Alice Chen', email: 'alice@company.com', role: 'CTO' },
    { name: 'Bob Smith', email: 'bob@company.com', role: 'Compliance Lead' },
  ],
}

export function makeDbQuery(run: ReturnType<typeof createRun>) {
  return run.guard(async function dbQuery(table: unknown, _filter?: unknown): Promise<unknown[]> {
    await new Promise(r => setTimeout(r, 50))
    return MOCK_DB[table as string] ?? []
  })
}
