import { useState, useEffect, useRef, useCallback } from 'react'

export interface WsEvent {
  type: string
  timestamp: string
  [key: string]: unknown
}

export function useWebSocket(url: string) {
  const [isConnected, setIsConnected] = useState(false)
  const [lastEvent, setLastEvent] = useState<WsEvent | null>(null)
  const [events, setEvents] = useState<WsEvent[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryCountRef = useRef(0)

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      setIsConnected(true)
      retryCountRef.current = 0
    }

    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data as string) as WsEvent
        setLastEvent(event)
        setEvents((prev) => [...prev.slice(-99), event])
      } catch { /* ignore */ }
    }

    ws.onclose = () => {
      setIsConnected(false)
      if (retryCountRef.current >= 20) return
      const delay = Math.min(1000 * 2 ** retryCountRef.current, 30000)
      retryCountRef.current++
      retryRef.current = setTimeout(connect, delay)
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [url])

  useEffect(() => {
    connect()
    return () => {
      if (retryRef.current) clearTimeout(retryRef.current)
      wsRef.current?.close()
    }
  }, [connect])

  return { lastEvent, isConnected, events }
}
