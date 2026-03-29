type Status = 'running' | 'completed' | 'failed' | 'killed' | 'budget_exceeded' | 'loop_detected'

const STATUS_STYLES: Record<string, { bg: string; text: string; pulse?: boolean }> = {
  running: { bg: '#27ae6020', text: '#27ae60', pulse: true },
  completed: { bg: '#27ae6020', text: '#27ae60' },
  failed: { bg: '#e74c3c20', text: '#e74c3c' },
  killed: { bg: '#ff6b3520', text: '#ff6b35' },
  budget_exceeded: { bg: '#f39c1220', text: '#f39c12' },
  loop_detected: { bg: '#f39c1220', text: '#f39c12' },
}

export function StatusBadge({ status }: { status: Status }) {
  const style = STATUS_STYLES[status] ?? { bg: '#ffffff10', text: '#8888aa' }
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${style.pulse ? 'animate-pulse' : ''}`}
      style={{ backgroundColor: style.bg, color: style.text }}
    >
      {status === 'running' && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
      {status.replace(/_/g, ' ')}
    </span>
  )
}
