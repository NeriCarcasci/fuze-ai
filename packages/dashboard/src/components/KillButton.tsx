import { useState } from 'react'
import { killRun } from '../api/client.js'

export function KillButton({ runId, onKilled }: { runId: string; onKilled?: () => void }) {
  const [loading, setLoading] = useState(false)

  const handleKill = async () => {
    if (!confirm(`Kill run ${runId}?`)) return
    setLoading(true)
    try {
      await killRun(runId)
      onKilled?.()
    } catch (e) {
      alert(`Failed to kill run: ${(e as Error).message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={() => void handleKill()}
      disabled={loading}
      className="px-2 py-1 rounded text-xs font-medium transition-opacity disabled:opacity-50"
      style={{ backgroundColor: '#e74c3c20', color: '#e74c3c', border: '1px solid #e74c3c40' }}
    >
      {loading ? '...' : '⏹ Kill'}
    </button>
  )
}
