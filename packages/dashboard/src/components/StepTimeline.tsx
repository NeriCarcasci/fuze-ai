import type { StepRecord, GuardEvent } from '../api/client.js'
import { GuardEventBadge } from './GuardEventBadge.js'

interface StepTimelineProps {
  steps: StepRecord[]
  guardEvents: GuardEvent[]
  selectedStepId?: string
  onSelectStep: (stepId: string) => void
}

export function StepTimeline({ steps, guardEvents, selectedStepId, onSelectStep }: StepTimelineProps) {
  return (
    <div className="flex flex-col gap-1">
      {steps.map((step) => {
        const stepEvents = guardEvents.filter((e) => e.stepId === step.stepId)
        const isSelected = step.stepId === selectedStepId

        return (
          <button
            key={step.stepId}
            onClick={() => onSelectStep(step.stepId)}
            className="flex items-start gap-3 p-3 rounded-lg text-left transition-colors w-full"
            style={{
              backgroundColor: isSelected ? 'var(--bg-elevated)' : 'transparent',
              border: `1px solid ${isSelected ? 'var(--accent-primary)' : 'var(--bg-border)'}`,
            }}
          >
            <span
              className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-mono shrink-0 mt-0.5"
              style={{ backgroundColor: 'var(--bg-border)', color: 'var(--text-secondary)' }}
            >
              {step.stepNumber}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  {step.toolName}
                </span>
                {step.hasSideEffect === 1 && (
                  <span title="Side effect" className="text-xs">⚡</span>
                )}
                {step.error && (
                  <span className="text-xs" style={{ color: 'var(--color-error)' }}>✗</span>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                <span>{step.latencyMs}ms</span>
                <span style={{ color: 'var(--accent-orange)' }}>${step.costUsd.toFixed(4)}</span>
              </div>
              {stepEvents.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {stepEvents.map((e) => (
                    <GuardEventBadge key={e.eventId} eventType={e.eventType} severity={e.severity} />
                  ))}
                </div>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}
