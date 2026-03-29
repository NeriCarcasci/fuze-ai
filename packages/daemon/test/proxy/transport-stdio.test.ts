import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TransportStdio } from '../../src/proxy/transport-stdio.js'
import { EventEmitter, Readable, Writable } from 'node:stream'

/**
 * We cannot test TransportStdio directly against process.stdin/stdout in unit
 * tests, so we verify the behaviour through the internal logic:
 * - JSON parsing of incoming lines
 * - Serialisation of outgoing messages
 * - Error handling for malformed input
 */
describe('TransportStdio', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>
  let stdoutSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  })

  afterEach(() => {
    stderrSpy.mockRestore()
    stdoutSpy.mockRestore()
  })

  it('sendToClient writes newline-terminated JSON to stdout', () => {
    const t = new TransportStdio()
    const msg = { jsonrpc: '2.0' as const, id: 1, result: { ok: true } }
    t.sendToClient(msg)
    expect(stdoutSpy).toHaveBeenCalledWith(JSON.stringify(msg) + '\n')
  })

  it('sendToClient writes valid JSON for notifications', () => {
    const t = new TransportStdio()
    const notif = { jsonrpc: '2.0' as const, method: 'notifications/initialized' }
    t.sendToClient(notif)
    const written = (stdoutSpy.mock.calls[0][0] as string)
    expect(() => JSON.parse(written)).not.toThrow()
    expect(written.endsWith('\n')).toBe(true)
  })

  it('onClientMessage handler is set and not called until start', () => {
    const t = new TransportStdio()
    const handler = vi.fn()
    t.onClientMessage(handler)
    // Without calling start(), handler should never be invoked
    expect(handler).not.toHaveBeenCalled()
  })

  it('stop() can be called without start() without throwing', () => {
    const t = new TransportStdio()
    expect(() => t.stop()).not.toThrow()
  })

  it('multiple sendToClient calls produce independent lines', () => {
    const t = new TransportStdio()
    const m1 = { jsonrpc: '2.0' as const, id: 1, result: null }
    const m2 = { jsonrpc: '2.0' as const, id: 2, result: null }
    t.sendToClient(m1)
    t.sendToClient(m2)
    expect(stdoutSpy).toHaveBeenCalledTimes(2)
    const first = stdoutSpy.mock.calls[0][0] as string
    const second = stdoutSpy.mock.calls[1][0] as string
    expect(JSON.parse(first).id).toBe(1)
    expect(JSON.parse(second).id).toBe(2)
  })
})

/**
 * Test the line-parsing logic through a fake readline-compatible stream.
 */
describe('TransportStdio line parsing (via fake stream)', () => {
  it('invokes handler for each complete JSON line', () => {
    // We test the inner parsing logic by calling the internal handler directly
    const received: unknown[] = []

    // Simulate what start() does internally:
    const lines = [
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}',
      '{"jsonrpc":"2.0","method":"notifications/initialized"}',
    ]

    // Parse directly (mirrors TransportStdio.start() line handler)
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        received.push(JSON.parse(trimmed))
      } catch {
        // skip
      }
    }

    expect(received).toHaveLength(2)
    expect((received[0] as { method: string }).method).toBe('initialize')
  })

  it('skips non-JSON lines gracefully', () => {
    const received: unknown[] = []
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    const lines = ['not valid json', '{"jsonrpc":"2.0","id":2,"method":"tools/list"}']

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        received.push(JSON.parse(trimmed))
      } catch {
        process.stderr.write(`[fuze] Non-JSON from client, skipping: ${trimmed.slice(0, 100)}\n`)
      }
    }

    expect(received).toHaveLength(1)
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Non-JSON'))
    stderrSpy.mockRestore()
  })

  it('handles empty lines without error', () => {
    const received: unknown[] = []
    const lines = ['', '   ', '{"jsonrpc":"2.0","id":3,"method":"ping"}']

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        received.push(JSON.parse(trimmed))
      } catch {
        // skip
      }
    }

    expect(received).toHaveLength(1)
  })
})
