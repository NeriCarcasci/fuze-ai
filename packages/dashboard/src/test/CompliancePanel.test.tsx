import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CompliancePanel } from '../views/CompliancePanel.js'
import * as client from '../api/client.js'

vi.mock('../api/client.js')

describe('CompliancePanel', () => {
  beforeEach(() => {
    vi.mocked(client.fetchRuns).mockResolvedValue({
      runs: [{
        runId: 'run-1',
        agentId: 'test-agent',
        agentVersion: '1.0',
        modelProvider: 'openai',
        modelName: 'gpt-4',
        status: 'completed',
        startedAt: '2026-01-01T00:00:00Z',
        totalCost: 0.05,
        totalTokensIn: 100,
        totalTokensOut: 200,
        totalSteps: 5,
        configJson: '{}',
      }],
      total: 1,
    })
  })

  it('renders checklist items', async () => {
    render(<MemoryRouter><CompliancePanel /></MemoryRouter>)
    await waitFor(() => {
      expect(screen.getByText('Record-keeping')).toBeTruthy()
      expect(screen.getByText('Human oversight')).toBeTruthy()
      expect(screen.getByText('Log retention')).toBeTruthy()
    })
  })

  it('shows risk level selector', async () => {
    render(<MemoryRouter><CompliancePanel /></MemoryRouter>)
    await waitFor(() => {
      expect(screen.getByText('Minimal')).toBeTruthy()
      expect(screen.getByText('Limited')).toBeTruthy()
      expect(screen.getByText('High-Risk')).toBeTruthy()
    })
  })

  it('selecting a run shows generate button', async () => {
    vi.mocked(client.generateIncidentReport).mockResolvedValue({} as client.IncidentReport)

    render(<MemoryRouter><CompliancePanel /></MemoryRouter>)
    await waitFor(() => screen.getByText(/Select a run/))

    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'run-1' } })

    await waitFor(() => {
      expect(screen.getByText('Generate Report')).toBeTruthy()
    })
  })

  it('all EU AI Act articles are present in checklist', async () => {
    render(<MemoryRouter><CompliancePanel /></MemoryRouter>)
    await waitFor(() => {
      for (const article of ['Art. 12', 'Art. 14', 'Art. 15', 'Art. 19', 'Art. 72', 'Art. 73']) {
        expect(screen.getByText(article)).toBeTruthy()
      }
    })
  })
})
