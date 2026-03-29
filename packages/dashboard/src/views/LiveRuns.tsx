import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRuns } from '../hooks/useRuns.js'
import { useWebSocket } from '../hooks/useWebSocket.js'
import { RunCard } from '../components/RunCard.js'

const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`

export function LiveRuns() {
  const { runs, loading, error, reload, setRuns } = useRuns()
  const { lastEvent, isConnected } = useWebSocket(WS_URL)
  const navigate = useNavigate()

  // Update run list on relevant WS events
  useEffect(() => {
    if (!lastEvent) return
    if (['run_start', 'run_end', 'step_end', 'guard_event'].includes(lastEvent.type)) {
      reload()
    }
  }, [lastEvent, reload])

  const activeRuns = runs.filter((r) => r.status === 'running')
  const recentRuns = runs.filter((r) => r.status !== 'running')
  const totalCost = runs.reduce((s, r) => s + r.totalCost, 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Live Runs</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm" style={{ color: isConnected ? 'var(--color-success)' : 'var(--color-error)' }}>
            ● {isConnected ? 'Live' : 'Disconnected'}
          </span>
          <span className="text-sm font-mono" style={{ color: 'var(--accent-orange)' }}>
            ${totalCost.toFixed(4)} total
          </span>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded" style={{ backgroundColor: '#e74c3c20', color: '#e74c3c' }}>
          {error}
        </div>
      )}

      <section className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Active</h2>
          {activeRuns.length > 0 && (
            <span
              className="px-2 py-0.5 rounded-full text-xs font-bold"
              style={{ backgroundColor: '#27ae6020', color: '#27ae60' }}
            >
              {activeRuns.length}
            </span>
          )}
        </div>
        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
        ) : activeRuns.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No active runs</p>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))' }}>
            {activeRuns.map((run) => (
              <RunCard
                key={run.runId}
                run={run}
                onKilled={reload}
                onClick={() => navigate(`/trace/${run.runId}`)}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Recent</h2>
        {recentRuns.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No completed runs</p>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))' }}>
            {recentRuns.slice(0, 20).map((run) => (
              <RunCard
                key={run.runId}
                run={run}
                onClick={() => navigate(`/trace/${run.runId}`)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
