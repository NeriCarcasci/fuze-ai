import { useBudget } from '../hooks/useBudget.js'
import { useRuns } from '../hooks/useRuns.js'
import { SpendChart } from '../components/SpendChart.js'
import { CostTicker } from '../components/CostTicker.js'

function getDailySpend(runs: { startedAt: string; totalCost: number }[], days = 30) {
  const buckets: Record<string, number> = {}
  const now = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    buckets[d.toISOString().slice(0, 10)] = 0
  }
  for (const r of runs) {
    const day = r.startedAt.slice(0, 10)
    if (day in buckets) buckets[day] += r.totalCost
  }
  return Object.entries(buckets).map(([date, spend]) => ({ date: date.slice(5), spend }))
}

export function BudgetDashboard() {
  const { budget, loading: budgetLoading } = useBudget()
  const { runs, loading: runsLoading } = useRuns({ limit: 200 })

  const dailySpend = getDailySpend(runs)
  const agentSpend = Object.entries(budget?.agents ?? {})
    .sort(([, a], [, b]) => b.spent - a.spent)

  const org = budget?.org
  const pct = org ? Math.min(100, (org.dailySpend / Math.max(org.dailyBudget, 0.0001)) * 100) : 0

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6" style={{ color: 'var(--text-primary)' }}>Budget Dashboard</h1>

      {budgetLoading ? <p style={{ color: 'var(--text-muted)' }}>Loading...</p> : org && (
        <div className="mb-8 p-4 rounded-lg" style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--bg-border)' }}>
          <div className="flex justify-between mb-2">
            <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Daily Org Spend</span>
            <span className="text-sm font-mono" style={{ color: 'var(--accent-orange)' }}>
              ${org.dailySpend.toFixed(4)} / ${org.dailyBudget.toFixed(2)}
            </span>
          </div>
          <div className="h-3 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-border)' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${pct}%`,
                backgroundColor: pct > 90 ? 'var(--color-error)' : pct > 70 ? 'var(--color-warning)' : 'var(--accent-primary)',
              }}
              data-testid="budget-progress"
            />
          </div>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>{pct.toFixed(1)}% used</p>
        </div>
      )}

      <div className="mb-8 p-4 rounded-lg" style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--bg-border)' }}>
        <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>30-Day Spend</h2>
        {runsLoading ? <p style={{ color: 'var(--text-muted)' }}>Loading...</p> : <SpendChart data={dailySpend} />}
      </div>

      <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--bg-border)' }}>
        <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Agents by Spend</h2>
        {agentSpend.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No agent data</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ color: 'var(--text-secondary)' }}>
                <th className="text-left py-2">Agent</th>
                <th className="text-right py-2">Spent</th>
                <th className="text-right py-2">Budget</th>
                <th className="text-right py-2">% Used</th>
              </tr>
            </thead>
            <tbody>
              {agentSpend.map(([agentId, data]) => {
                const usedPct = (data.spent / Math.max(data.budget, 0.0001)) * 100
                return (
                  <tr key={agentId} style={{ borderTop: '1px solid var(--bg-border)' }}>
                    <td className="py-2 font-mono text-xs" style={{ color: 'var(--text-primary)' }}>{agentId}</td>
                    <td className="text-right py-2"><CostTicker value={data.spent} /></td>
                    <td className="text-right py-2" style={{ color: 'var(--text-secondary)' }}>${data.budget.toFixed(2)}</td>
                    <td className="text-right py-2" style={{ color: usedPct > 80 ? 'var(--color-warning)' : 'var(--text-secondary)' }}>
                      {usedPct.toFixed(1)}%
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
