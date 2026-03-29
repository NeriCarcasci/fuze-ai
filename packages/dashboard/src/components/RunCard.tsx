import type { RunRecord, GuardEvent } from '../api/client.js'
import { StatusBadge } from './StatusBadge.js'
import { CostTicker } from './CostTicker.js'
import { KillButton } from './KillButton.js'
import { GuardEventBadge } from './GuardEventBadge.js'

interface RunCardProps {
  run: RunRecord
  guardEvents?: GuardEvent[]
  onKilled?: () => void
  onClick?: () => void
}

export function RunCard({ run, guardEvents = [], onKilled, onClick }: RunCardProps) {
  const durationMs = run.endedAt
    ? new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime()
    : Date.now() - new Date(run.startedAt).getTime()
  const durationSec = (durationMs / 1000).toFixed(1)

  return (
    <div
      className="rounded-lg p-4 border cursor-pointer hover:border-white/20 transition-colors"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--bg-border)' }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onClick?.() }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <StatusBadge status={run.status} />
          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            {run.agentId}
          </span>
        </div>
        {run.status === 'running' && (
          <KillButton runId={run.runId} onKilled={onKilled} />
        )}
      </div>
      <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
        <span>{run.modelProvider}/{run.modelName}</span>
        <span>{run.totalSteps} steps</span>
        <CostTicker value={run.totalCost} />
        <span>{durationSec}s</span>
      </div>
      {guardEvents.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {guardEvents.map((e) => (
            <GuardEventBadge key={e.eventId} eventType={e.eventType} severity={e.severity} />
          ))}
        </div>
      )}
      <div className="mt-1 text-xs truncate" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
        {run.runId}
      </div>
    </div>
  )
}
