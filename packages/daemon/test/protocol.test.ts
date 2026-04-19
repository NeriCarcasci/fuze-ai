import { describe, it, expect } from 'vitest'
import { parseMessage, serialiseResponse, PROCEED } from '../src/protocol.js'

describe('parseMessage', () => {
  it('parses a valid run_start message', () => {
    const msg = parseMessage(JSON.stringify({ type: 'run_start', runId: 'r1', agentId: 'a1' }))
    expect(msg.type).toBe('run_start')
    if (msg.type === 'run_start') {
      expect(msg.runId).toBe('r1')
      expect(msg.agentId).toBe('a1')
    }
  })

  it('parses a valid step_start message', () => {
    const msg = parseMessage(JSON.stringify({
      type: 'step_start', runId: 'r1', stepId: 's1', stepNumber: 1,
      toolName: 'myTool', argsHash: 'abc123', sideEffect: false,
    }))
    expect(msg.type).toBe('step_start')
  })

  it('parses a valid step_end message', () => {
    const msg = parseMessage(JSON.stringify({
      type: 'step_end', runId: 'r1', stepId: 's1',
      tokensIn: 100, tokensOut: 50, latencyMs: 200,
    }))
    expect(msg.type).toBe('step_end')
  })

  it('parses a valid run_end message', () => {
    const msg = parseMessage(JSON.stringify({
      type: 'run_end', runId: 'r1', status: 'completed',
    }))
    expect(msg.type).toBe('run_end')
  })

  it('parses a valid guard_event message', () => {
    const msg = parseMessage(JSON.stringify({
      type: 'guard_event', runId: 'r1',
      eventType: 'loop_detected', severity: 'warning', details: {},
    }))
    expect(msg.type).toBe('guard_event')
  })

  it('throws on invalid JSON', () => {
    expect(() => parseMessage('not json')).toThrow('Protocol: malformed JSON')
  })

  it('throws on unknown message type', () => {
    expect(() => parseMessage(JSON.stringify({ type: 'unknown_type' }))).toThrow(
      "Protocol: unknown message type 'unknown_type'",
    )
  })

  it('throws on missing required fields', () => {
    expect(() => parseMessage(JSON.stringify({ type: 'run_start', runId: 'r1' }))).toThrow(
      'missing required fields',
    )
  })
})

describe('serialiseResponse', () => {
  it('serialises proceed response with trailing newline', () => {
    const s = serialiseResponse(PROCEED)
    expect(s).toBe('{"type":"proceed"}\n')
  })

  it('serialises kill response', () => {
    const s = serialiseResponse({ type: 'kill', reason: 'budget', message: 'over limit' })
    expect(s).toContain('"type":"kill"')
    expect(s.endsWith('\n')).toBe(true)
  })
})
