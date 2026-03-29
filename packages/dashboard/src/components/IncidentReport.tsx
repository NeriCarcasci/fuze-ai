import { useState } from 'react'
import { generateIncidentReport } from '../api/client.js'

export function IncidentReport({ runId }: { runId: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleGenerate = async () => {
    setLoading(true)
    setError(null)
    try {
      const report = await generateIncidentReport(runId)
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `incident-report-${runId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <button
        onClick={() => void handleGenerate()}
        disabled={loading}
        className="px-3 py-2 rounded text-sm font-medium transition-opacity disabled:opacity-50"
        style={{ backgroundColor: 'var(--accent-primary)', color: 'white' }}
      >
        {loading ? 'Generating...' : 'Generate Report'}
      </button>
      {error && (
        <p className="mt-2 text-xs" style={{ color: 'var(--color-error)' }}>{error}</p>
      )}
    </div>
  )
}
