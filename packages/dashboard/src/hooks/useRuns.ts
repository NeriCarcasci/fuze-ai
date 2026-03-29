import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchRuns, type RunRecord } from '../api/client.js'

export function useRuns(params?: { status?: string; agentId?: string; limit?: number }) {
  const [runs, setRuns] = useState<RunRecord[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const paramsRef = useRef(params)
  paramsRef.current = params

  const load = useCallback(() => {
    setLoading(true)
    fetchRuns(paramsRef.current)
      .then(({ runs: r, total: t }) => {
        setRuns(r)
        setTotal(t)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [params?.status, params?.agentId, params?.limit, load])

  return { runs, total, loading, error, reload: load, setRuns }
}
