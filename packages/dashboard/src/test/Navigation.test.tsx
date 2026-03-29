import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { App } from '../App.js'
import * as client from '../api/client.js'

vi.mock('../api/client.js')
vi.mock('../hooks/useWebSocket.js', () => ({
  useWebSocket: () => ({ lastEvent: null, isConnected: true, events: [] }),
}))

describe('Navigation', () => {
  beforeEach(() => {
    vi.mocked(client.fetchRuns).mockResolvedValue({ runs: [], total: 0 })
    vi.mocked(client.fetchBudget).mockResolvedValue({
      org: { dailySpend: 0, dailyBudget: 100, runningAgents: 0 },
      agents: {},
    })
  })

  it('renders Live Runs by default', async () => {
    render(<App />)
    await waitFor(() => {
      // "Live Runs" appears in both sidebar and page heading — verify at least one exists
      expect(screen.getAllByText('Live Runs').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('navigates to Budget via sidebar', async () => {
    render(<App />)
    // NavLink: find the <a> whose accessible name includes "Budget"
    await waitFor(() => screen.getByRole('link', { name: /Budget/ }))
    fireEvent.click(screen.getByRole('link', { name: /Budget/ }))
    await waitFor(() => {
      expect(screen.getByText('Budget Dashboard')).toBeTruthy()
    })
  })

  it('navigates to Compliance via sidebar', async () => {
    render(<App />)
    await waitFor(() => screen.getByRole('link', { name: /Compliance/ }))
    fireEvent.click(screen.getByRole('link', { name: /Compliance/ }))
    await waitFor(() => {
      expect(screen.getByText('Compliance Panel')).toBeTruthy()
    })
  })
})
