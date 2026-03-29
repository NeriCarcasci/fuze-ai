import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AgentHealth } from '../views/AgentHealth.js'
import * as client from '../api/client.js'

vi.mock('../api/client.js')

describe('AgentHealth', () => {
  beforeEach(() => {
    vi.mocked(client.fetchAgentHealth).mockResolvedValue({
      agentId: 'test-agent',
      reliability: {
        totalRuns: 42,
        successRate: 0.95,
        avgCost: 0.012,
        failureHotspot: null,
      },
      spend: { spent: 1.5, budget: 10 },
    })
  })

  function renderComponent() {
    return render(
      <MemoryRouter>
        <AgentHealth />
      </MemoryRouter>
    )
  }

  it('renders without crashing', () => {
    renderComponent()
    expect(screen.getByText('Agent Health')).toBeTruthy()
  })

  it('search triggers API call and displays results', async () => {
    renderComponent()
    const input = screen.getByPlaceholderText('Enter agent ID...')
    fireEvent.change(input, { target: { value: 'test-agent' } })
    fireEvent.click(screen.getByText('Look up'))

    await waitFor(() => {
      expect(client.fetchAgentHealth).toHaveBeenCalledWith('test-agent')
    })

    await waitFor(() => {
      expect(screen.getByTestId('reliability-score')).toBeTruthy()
      expect(screen.getByText('95.0%')).toBeTruthy()
    })
  })

  it('displays reliability score', async () => {
    renderComponent()
    const input = screen.getByPlaceholderText('Enter agent ID...')
    fireEvent.change(input, { target: { value: 'test-agent' } })
    fireEvent.click(screen.getByText('Look up'))

    await waitFor(() => {
      expect(screen.getByText('Reliability Score')).toBeTruthy()
      expect(screen.getByText('42')).toBeTruthy()
    })
  })
})
