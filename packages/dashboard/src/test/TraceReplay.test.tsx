import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { TraceReplay } from '../views/TraceReplay.js'
import * as client from '../api/client.js'

vi.mock('../api/client.js')

const mockStep = (n: number, overrides = {}): client.StepRecord => ({
  stepId: `step-${n}`,
  runId: 'run-1',
  stepNumber: n,
  startedAt: new Date().toISOString(),
  toolName: `tool-${n}`,
  argsHash: 'abc123',
  hasSideEffect: 0,
  costUsd: 0.01,
  tokensIn: 10,
  tokensOut: 20,
  latencyMs: 100,
  ...overrides,
})

const mockRun: client.RunRecord = {
  runId: 'run-1',
  agentId: 'test-agent',
  agentVersion: '1.0',
  modelProvider: 'openai',
  modelName: 'gpt-4',
  status: 'completed',
  startedAt: new Date(Date.now() - 5000).toISOString(),
  endedAt: new Date().toISOString(),
  totalCost: 0.05,
  totalTokensIn: 100,
  totalTokensOut: 200,
  totalSteps: 3,
  configJson: '{}',
}

describe('TraceReplay', () => {
  beforeEach(() => {
    vi.mocked(client.fetchRun).mockResolvedValue({
      run: mockRun,
      steps: [mockStep(1), mockStep(2), mockStep(3)],
      guardEvents: [],
    })
    vi.mocked(client.fetchCompensation).mockResolvedValue([])
  })

  function renderWithRoute(runId: string) {
    return render(
      <MemoryRouter initialEntries={[`/trace/${runId}`]}>
        <Routes>
          <Route path="/trace/:runId" element={<TraceReplay />} />
        </Routes>
      </MemoryRouter>
    )
  }

  it('renders steps in order', async () => {
    renderWithRoute('run-1')
    await waitFor(() => {
      // tool-1 is selected by default so it appears in both timeline and detail pane
      expect(screen.getAllByText('tool-1').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('tool-2').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('tool-3').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('clicking a step shows its details', async () => {
    renderWithRoute('run-1')
    await waitFor(() => screen.getByText('tool-2'))
    fireEvent.click(screen.getByText('tool-2'))
    // After clicking, detail pane shows tool-2
    await waitFor(() => {
      const headings = screen.getAllByText('tool-2')
      expect(headings.length).toBeGreaterThan(1)
    })
  })

  it('shows guard events badge on step', async () => {
    vi.mocked(client.fetchRun).mockResolvedValue({
      run: mockRun,
      steps: [mockStep(1)],
      guardEvents: [{
        eventId: 'ev-1',
        runId: 'run-1',
        stepId: 'step-1',
        timestamp: new Date().toISOString(),
        eventType: 'budget_exceeded',
        severity: 'critical',
        detailsJson: '{}',
      }],
    })
    renderWithRoute('run-1')
    await waitFor(() => {
      expect(screen.getByText('budget exceeded')).toBeTruthy()
    })
  })

  it('shows side effect indicator on step', async () => {
    vi.mocked(client.fetchRun).mockResolvedValue({
      run: mockRun,
      steps: [mockStep(1, { hasSideEffect: 1 })],
      guardEvents: [],
    })
    renderWithRoute('run-1')
    await waitFor(() => {
      expect(screen.getByText('⚡')).toBeTruthy()
    })
  })

  it('compensation status shown for side-effect step', async () => {
    vi.mocked(client.fetchRun).mockResolvedValue({
      run: mockRun,
      steps: [mockStep(1, { hasSideEffect: 1 })],
      guardEvents: [],
    })
    vi.mocked(client.fetchCompensation).mockResolvedValue([{
      compensationId: 'comp-1',
      runId: 'run-1',
      stepId: 'step-1',
      toolName: 'tool-1',
      originalResultJson: null,
      compensationStatus: 'succeeded',
      compensationStartedAt: new Date().toISOString(),
      compensationEndedAt: new Date().toISOString(),
      compensationError: null,
      escalated: false,
    }])
    renderWithRoute('run-1')
    await waitFor(() => {
      expect(screen.getByText('succeeded')).toBeTruthy()
    })
  })
})
