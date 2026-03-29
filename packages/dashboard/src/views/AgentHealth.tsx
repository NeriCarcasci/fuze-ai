import { useState } from 'react'
import { fetchAgentHealth, type AgentHealthResponse } from '../api/client.js'
import { useNavigate } from 'react-router-dom'

export function AgentHealth() {
  const [agentId, setAgentId] = useState('')
  const [data, setData] = useState<AgentHealthResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  const handleSearch = async () => {
    if (!agentId.trim()) return
    setLoading(true)
    setError(null)
    try {
      const result = await fetchAgentHealth(agentId.trim())
      setData(result)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const successPct = data ? (data.reliability.successRate * 100).toFixed(1) : '–'

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6" style={{ color: 'var(--text-primary)' }}>Agent Health</h1>

      <div className="flex gap-3 mb-6">
        <input
          type="text"
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleSearch() }}
          placeholder="Enter agent ID..."
          className="flex-1 rounded px-3 py-2 text-sm outline-none"
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--bg-border)',
            color: 'var(--text-primary)',
          }}
        />
        <button
          onClick={() => void handleSearch()}
          disabled={loading}
          className="px-4 py-2 rounded text-sm font-medium"
          style={{ backgroundColor: 'var(--accent-primary)', color: 'white' }}
        >
          {loading ? '...' : 'Look up'}
        </button>
      </div>

      {error && <p className="mb-4 text-sm" style={{ color: 'var(--color-error)' }}>{error}</p>}

      {data && (
        <div className="grid gap-4">
          <div className="p-6 rounded-lg text-center" style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--bg-border)' }}>
            <div
              className="text-6xl font-bold mb-2"
              data-testid="reliability-score"
              style={{ color: data.reliability.successRate > 0.9 ? 'var(--color-success)' : data.reliability.successRate > 0.7 ? 'var(--color-warning)' : 'var(--color-error)' }}
            >
              {successPct}%
            </div>
            <p style={{ color: 'var(--text-secondary)' }}>Reliability Score</p>
          </div>

          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Total Runs', value: data.reliability.totalRuns },
              { label: 'Avg Cost', value: `$${data.reliability.avgCost.toFixed(4)}` },
              { label: 'Agent Spend', value: `$${data.spend.spent.toFixed(4)}` },
            ].map(({ label, value }) => (
              <div key={label} className="p-4 rounded-lg text-center" style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--bg-border)' }}>
                <div className="text-xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>{value}</div>
                <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>{label}</div>
              </div>
            ))}
          </div>

          {data.reliability.failureHotspot && (
            <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--bg-border)' }}>
              <h3 className="text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Failure Hotspot</h3>
              <p style={{ color: 'var(--color-error)' }}>
                {data.reliability.failureHotspot.tool} at step {data.reliability.failureHotspot.step}
                <span className="ml-2" style={{ color: 'var(--text-muted)' }}>({data.reliability.failureHotspot.count}x)</span>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
