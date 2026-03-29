import { useState, useEffect } from 'react'
import { fetchBudget, type BudgetResponse } from '../api/client.js'

export function useBudget() {
  const [budget, setBudget] = useState<BudgetResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchBudget()
      .then((b) => { setBudget(b); setError(null) })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  return { budget, loading, error }
}
