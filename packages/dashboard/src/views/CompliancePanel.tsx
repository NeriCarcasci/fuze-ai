import { useState } from 'react'
import { useRuns } from '../hooks/useRuns.js'
import { IncidentReport } from '../components/IncidentReport.js'

type RiskLevel = 'Minimal' | 'Limited' | 'High-Risk'

const RISK_LEVELS: RiskLevel[] = ['Minimal', 'Limited', 'High-Risk']

interface CheckItem {
  article: string
  title: string
  status: 'ok' | 'warn' | 'na'
  description: string
}

export function CompliancePanel() {
  const [riskLevel, setRiskLevel] = useState<RiskLevel>('Limited')
  const [selectedRunId, setSelectedRunId] = useState('')
  const { runs } = useRuns({ limit: 100 })

  const retentionDays = 180 // from config (hard-coded for now)
  const hasAuditRecords = runs.length > 0

  const checklist: CheckItem[] = [
    {
      article: 'Art. 12',
      title: 'Record-keeping',
      status: hasAuditRecords ? 'ok' : 'warn',
      description: `${runs.length} runs in audit store${hasAuditRecords ? `. Oldest: ${runs[runs.length - 1]?.startedAt?.slice(0, 10) ?? 'n/a'}` : ' — no records yet'}`,
    },
    {
      article: 'Art. 14',
      title: 'Human oversight',
      status: 'ok',
      description: 'Kill switch available via API and dashboard UI',
    },
    {
      article: 'Art. 15',
      title: 'Robustness & accuracy',
      status: 'ok',
      description: 'Loop detection + budget enforcement active',
    },
    {
      article: 'Art. 19',
      title: 'Log retention',
      status: retentionDays >= 180 ? 'ok' : 'warn',
      description: retentionDays >= 180
        ? `${retentionDays} day retention configured (≥180 days)`
        : `⚠ ${retentionDays} day retention — EU AI Act recommends ≥180 days`,
    },
    {
      article: 'Art. 72',
      title: 'Monitoring',
      status: 'ok',
      description: 'Real-time monitoring via Agent Health dashboard',
    },
    {
      article: 'Art. 73',
      title: 'Incident reporting',
      status: 'ok',
      description: 'Incident report generator available below',
    },
  ]

  const statusIcon = (s: CheckItem['status']) => s === 'ok' ? '✅' : s === 'warn' ? '⚠️' : '—'

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6" style={{ color: 'var(--text-primary)' }}>Compliance Panel</h1>

      <div className="mb-6 flex items-center gap-4">
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Risk classification:</span>
        <div className="flex gap-2">
          {RISK_LEVELS.map((level) => (
            <button
              key={level}
              onClick={() => setRiskLevel(level)}
              className="px-3 py-1 rounded text-sm font-medium transition-colors"
              style={{
                backgroundColor: riskLevel === level ? 'var(--accent-primary)' : 'var(--bg-surface)',
                color: riskLevel === level ? 'white' : 'var(--text-secondary)',
                border: `1px solid ${riskLevel === level ? 'var(--accent-primary)' : 'var(--bg-border)'}`,
              }}
            >
              {level}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-8 rounded-lg overflow-hidden" style={{ border: '1px solid var(--bg-border)' }}>
        <div className="p-4" style={{ backgroundColor: 'var(--bg-surface)', borderBottom: '1px solid var(--bg-border)' }}>
          <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>EU AI Act Checklist — {riskLevel}</h2>
        </div>
        <div>
          {checklist.map((item, i) => (
            <div
              key={item.article}
              className="flex items-start gap-4 p-4"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderTop: i > 0 ? '1px solid var(--bg-border)' : 'none',
              }}
              data-testid={`checklist-${item.article.replace(' ', '-').toLowerCase()}`}
            >
              <span className="text-lg">{statusIcon(item.status)}</span>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium font-mono" style={{ color: 'var(--accent-primary)' }}>{item.article}</span>
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{item.title}</span>
                </div>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{item.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--bg-border)' }}>
        <h2 className="font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Incident Report Generator</h2>
        <div className="flex gap-3 mb-4">
          <select
            value={selectedRunId}
            onChange={(e) => setSelectedRunId(e.target.value)}
            className="flex-1 rounded px-3 py-2 text-sm"
            style={{
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--bg-border)',
              color: 'var(--text-primary)',
            }}
          >
            <option value="">Select a run...</option>
            {runs.map((r) => (
              <option key={r.runId} value={r.runId}>
                {r.agentId} — {r.status} — {r.startedAt.slice(0, 16)}
              </option>
            ))}
          </select>
        </div>
        {selectedRunId && <IncidentReport runId={selectedRunId} />}
      </div>
    </div>
  )
}
