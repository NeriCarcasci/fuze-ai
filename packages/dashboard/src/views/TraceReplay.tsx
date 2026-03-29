import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchRun, fetchCompensation, type RunDetailResponse, type CompensationRecord } from '../api/client.js'
import { StatusBadge } from '../components/StatusBadge.js'
import { StepTimeline } from '../components/StepTimeline.js'
import { CostTicker } from '../components/CostTicker.js'
import { CodeBlock } from '../components/CodeBlock.js'
import { CompensationStatus } from '../components/CompensationStatus.js'

export function TraceReplay() {
  const { runId } = useParams<{ runId: string }>()
  const navigate = useNavigate()
  const [data, setData] = useState<RunDetailResponse | null>(null)
  const [compensation, setCompensation] = useState<CompensationRecord[]>([])
  const [selectedStepId, setSelectedStepId] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!runId) return
    setLoading(true)
    Promise.all([fetchRun(runId), fetchCompensation(runId)])
      .then(([runData, comp]) => {
        setData(runData)
        setCompensation(comp)
        if (runData.steps.length > 0) setSelectedStepId(runData.steps[0].stepId)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [runId])

  if (!runId) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>Trace Replay</h1>
        <p style={{ color: 'var(--text-muted)' }}>Select a run from <button className="underline" style={{ color: 'var(--accent-primary)' }} onClick={() => navigate('/')}>Live Runs</button></p>
      </div>
    )
  }

  if (loading) return <p style={{ color: 'var(--text-muted)' }}>Loading trace...</p>
  if (error) return <p style={{ color: 'var(--color-error)' }}>{error}</p>
  if (!data) return null

  const { run, steps, guardEvents } = data
  const selectedStep = steps.find((s) => s.stepId === selectedStepId)
  const stepEvents = selectedStep ? guardEvents.filter((e) => e.stepId === selectedStep.stepId) : []
  const stepComp = selectedStep ? compensation.filter((c) => c.stepId === selectedStep.stepId) : []

  const durationMs = run.endedAt
    ? new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime()
    : Date.now() - new Date(run.startedAt).getTime()

  return (
    <div>
      <div className="mb-6 p-4 rounded-lg" style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--bg-border)' }}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <StatusBadge status={run.status} />
            <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{run.agentId}</span>
          </div>
          <div className="flex items-center gap-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
            <CostTicker value={run.totalCost} />
            <span>{(durationMs / 1000).toFixed(1)}s</span>
          </div>
        </div>
        <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{run.runId}</div>
      </div>

      <div className="flex gap-6">
        <div className="w-72 shrink-0">
          <h2 className="text-sm font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>Steps ({steps.length})</h2>
          <StepTimeline
            steps={steps}
            guardEvents={guardEvents}
            selectedStepId={selectedStepId}
            onSelectStep={setSelectedStepId}
          />
        </div>

        <div className="flex-1 min-w-0">
          {selectedStep ? (
            <div className="rounded-lg p-4" style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--bg-border)' }}>
              <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                {selectedStep.toolName}
                {selectedStep.hasSideEffect === 1 && <span className="ml-2 text-sm">⚡ Side effect</span>}
              </h2>
              <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Args hash</span>
                  <div className="font-mono mt-1" style={{ color: 'var(--text-secondary)' }}>{selectedStep.argsHash}</div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Cost</span>
                  <div className="mt-1"><CostTicker value={selectedStep.costUsd} /></div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Latency</span>
                  <div className="mt-1" style={{ color: 'var(--text-secondary)' }}>{selectedStep.latencyMs}ms</div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Tokens</span>
                  <div className="mt-1" style={{ color: 'var(--text-secondary)' }}>
                    {selectedStep.tokensIn} in / {selectedStep.tokensOut} out
                  </div>
                </div>
              </div>
              {selectedStep.error && (
                <div className="mb-4 p-3 rounded text-sm" style={{ backgroundColor: '#e74c3c20', color: '#e74c3c' }}>
                  {selectedStep.error}
                </div>
              )}
              {stepEvents.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Guard Events</h3>
                  <CodeBlock value={stepEvents.map((e) => ({ type: e.eventType, severity: e.severity, details: (() => { try { return JSON.parse(e.detailsJson) } catch { return e.detailsJson } })() }))} />
                </div>
              )}
              <CompensationStatus records={stepComp} />
            </div>
          ) : (
            <p style={{ color: 'var(--text-muted)' }}>Select a step to see details</p>
          )}
        </div>
      </div>
    </div>
  )
}
