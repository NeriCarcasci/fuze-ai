import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { BudgetDashboard } from '../views/BudgetDashboard.js'
import * as client from '../api/client.js'

vi.mock('../api/client.js')

const mockBudget: client.BudgetResponse = {
  org: { dailySpend: 7.5, dailyBudget: 10.0, runningAgents: 2 },
  agents: {
    'agent-a': { spent: 5.0, budget: 8.0 },
    'agent-b': { spent: 2.5, budget: 5.0 },
  },
}

describe('BudgetDashboard', () => {
  beforeEach(() => {
    vi.mocked(client.fetchBudget).mockResolvedValue(mockBudget)
    vi.mocked(client.fetchRuns).mockResolvedValue({ runs: [], total: 0 })
  })

  it('renders without crashing', async () => {
    render(<MemoryRouter><BudgetDashboard /></MemoryRouter>)
    await waitFor(() => {
      expect(screen.getByText('Budget Dashboard')).toBeTruthy()
    })
  })

  it('shows correct budget percentage', async () => {
    render(<MemoryRouter><BudgetDashboard /></MemoryRouter>)
    await waitFor(() => {
      expect(screen.getByText('75.0% used')).toBeTruthy()
    })
  })

  it('renders agent spend table', async () => {
    render(<MemoryRouter><BudgetDashboard /></MemoryRouter>)
    await waitFor(() => {
      expect(screen.getByText('agent-a')).toBeTruthy()
      expect(screen.getByText('agent-b')).toBeTruthy()
    })
  })
})
