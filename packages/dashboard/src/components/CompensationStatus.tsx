import type { CompensationRecord } from '../api/client.js'

const STATUS_COLORS: Record<string, string> = {
  succeeded: '#27ae60',
  failed: '#e74c3c',
  no_compensation: '#f39c12',
  pending: '#8888aa',
  skipped: '#555570',
}

export function CompensationStatus({ records }: { records: CompensationRecord[] }) {
  if (records.length === 0) return null

  return (
    <div className="mt-3">
      <h4 className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
        Compensation
      </h4>
      <div className="flex flex-col gap-1">
        {records.map((r) => (
          <div key={r.compensationId} className="flex items-center gap-2 text-xs">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: STATUS_COLORS[r.compensationStatus] ?? '#555570' }}
            />
            <span style={{ color: 'var(--text-secondary)' }}>{r.toolName}</span>
            <span style={{ color: STATUS_COLORS[r.compensationStatus] ?? '#555570' }}>
              {r.compensationStatus.replace(/_/g, ' ')}
            </span>
            {r.escalated && (
              <span style={{ color: 'var(--color-error)' }}>⚠ escalated</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
