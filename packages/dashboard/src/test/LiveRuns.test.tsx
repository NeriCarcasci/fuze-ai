import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LiveRuns } from '../views/LiveRuns.js'
import * as client from '../api/client.js'

vi.mock('../api/client.js')
vi.mock('../hooks/useWebSocket.js', () => ({
  useWebSocket: () => ({ lastEvent: null, isConnected: true, events: [] }),
}))

const mockRun = (overrides = {}): client.RunRecord => ({
  runId: 'run-1',
  agentId: 'test-agent',
  agentVersion: '1.0',
  modelProvider: 'openai',
  modelName: 'gpt-4',
  status: 'running',
  startedAt: new Date().toISOString(),
  totalCost: 0.05,
  totalTokensIn: 100,
  totalTokensOut: 200,
  totalSteps: 5,
  configJson: '{}',
  ...overrides,
})

describe('LiveRuns', () => {
  beforeEach(() => {
    vi.mocked(client.fetchRuns).mockResolvedValue({ runs: [], total: 0 })
    vi.mocked(client.killRun).mockResolvedValue()
  })

  it('renders without crashing', async () => {
    render(<MemoryRouter><LiveRuns /></MemoryRouter>)
    await waitFor(() => {
      expect(screen.getByText('Live Runs')).toBeTruthy()
    })
  })

  it('shows active runs', async () => {
    vi.mocked(client.fetchRuns).mockResolvedValue({
      runs: [mockRun()],
      total: 1,
    })
    render(<MemoryRouter><LiveRuns /></MemoryRouter>)
    await waitFor(() => {
      expect(screen.getByText('test-agent')).toBeTruthy()
    })
  })

  it('shows No active runs when none running', async () => {
    vi.mocked(client.fetchRuns).mockResolvedValue({
      runs: [mockRun({ status: 'completed' })],
      total: 1,
    })
    render(<MemoryRouter><LiveRuns /></MemoryRouter>)
    await waitFor(() => {
      expect(screen.getByText('No active runs')).toBeTruthy()
    })
  })

  it('kill button calls killRun API', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(client.fetchRuns).mockResolvedValue({
      runs: [mockRun()],
      total: 1,
    })
    render(<MemoryRouter><LiveRuns /></MemoryRouter>)
    await waitFor(() => screen.getByText('⏹ Kill'))
    fireEvent.click(screen.getByText('⏹ Kill'))
    await waitFor(() => {
      expect(client.killRun).toHaveBeenCalledWith('run-1')
    })
  })
})
