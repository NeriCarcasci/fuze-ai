import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { ToolInterceptor } from '../../src/proxy/tool-interceptor.js'
import type { ProxyConfig, ToolCallMessage } from '../../src/proxy/types.js'

function makeConfig(overrides: Partial<ProxyConfig> = {}): ProxyConfig {
  return {
    maxTokensPerRun: 1000,
    maxIterations: 10,
    tracePath: path.join(os.tmpdir(), `fuze-ti-trace-${Date.now()}.jsonl`),
    verbose: false,
    tools: overrides.tools ?? {},
    ...overrides,
  }
}

function makeCallMsg(
  toolName: string,
  args: Record<string, unknown> = {},
  id: number = 1,
): ToolCallMessage {
  return {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  }
}

describe('ToolInterceptor', () => {
  let traceFiles: string[] = []

  afterEach(() => {
    for (const f of traceFiles) {
      if (fs.existsSync(f)) fs.unlinkSync(f)
    }
    traceFiles = []
  })

  it('approves a normal tool call within budget', async () => {
    const config = makeConfig()
    traceFiles.push(config.tracePath)
    const ti = new ToolInterceptor(config, config.tracePath)

    const result = await ti.intercept(makeCallMsg('echo', { text: 'hi' }))
    expect(result.action).toBe('forward')
  })

  it('returns forward with estimatedTokens', async () => {
    const config = makeConfig({
      tools: { echo: { estimated_tokens: 20 } },
    })
    traceFiles.push(config.tracePath)
    const ti = new ToolInterceptor(config, config.tracePath)

    const result = await ti.intercept(makeCallMsg('echo', { text: 'hi' }))
    expect(result.action).toBe('forward')
    if (result.action === 'forward') {
      expect(result.estimatedTokens).toBe(20)
    }
  })

  it('blocks when token budget would be exceeded', async () => {
    const config = makeConfig({
      maxTokensPerRun: 5,
      tools: { query: { estimated_tokens: 10 } },
    })
    traceFiles.push(config.tracePath)
    const ti = new ToolInterceptor(config, config.tracePath)

    const result = await ti.intercept(makeCallMsg('query', {}, 1))
    expect(result.action).toBe('block')
    if (result.action === 'block') {
      expect(result.response.error.message).toContain('[fuze]')
      expect(result.response.error.message).toContain('Token budget exceeded')
      expect((result.response.error.data as Record<string, string>)['fuze_event']).toBe(
        'budget_exceeded',
      )
    }
  })

  it('preserves the JSON-RPC id in the block response', async () => {
    const config = makeConfig({
      maxTokensPerRun: 5,
      tools: { query: { estimated_tokens: 10 } },
    })
    traceFiles.push(config.tracePath)
    const ti = new ToolInterceptor(config, config.tracePath)

    const result = await ti.intercept(makeCallMsg('query', {}, 42))
    expect(result.action).toBe('block')
    if (result.action === 'block') {
      expect(result.response.id).toBe(42)
      expect(result.response.jsonrpc).toBe('2.0')
    }
  })

  it('blocks on repeated identical tool+args (loop detection)', async () => {
    // repeatThreshold is 3 — same signature 3 times → block on 3rd
    const config = makeConfig({ maxTokensPerRun: 100 })
    traceFiles.push(config.tracePath)
    const ti = new ToolInterceptor(config, config.tracePath)

    const msg = makeCallMsg('echo', { text: 'same' }, 1)
    const r1 = await ti.intercept({ ...msg, id: 1 })
    const r2 = await ti.intercept({ ...msg, id: 2 })
    const r3 = await ti.intercept({ ...msg, id: 3 })

    expect(r1.action).toBe('forward')
    expect(r2.action).toBe('forward')
    expect(r3.action).toBe('block')
    if (r3.action === 'block') {
      expect(r3.response.error.message).toContain('Loop detected')
    }
  })

  it('does not block when args differ between calls', async () => {
    const config = makeConfig({ maxTokensPerRun: 100 })
    traceFiles.push(config.tracePath)
    const ti = new ToolInterceptor(config, config.tracePath)

    for (let i = 0; i < 5; i++) {
      const r = await ti.intercept(makeCallMsg('echo', { text: `unique-${i}` }, i))
      expect(r.action).toBe('forward')
    }
  })

  it('blocks after max iterations', async () => {
    const config = makeConfig({ maxIterations: 3, maxTokensPerRun: 100 })
    traceFiles.push(config.tracePath)
    const ti = new ToolInterceptor(config, config.tracePath)

    // Use different args each time to avoid loop detector, hit iteration cap
    for (let i = 0; i < 3; i++) {
      const r = await ti.intercept(makeCallMsg('echo', { text: `unique-${i}` }, i))
      expect(r.action).toBe('forward')
    }
    const r4 = await ti.intercept(makeCallMsg('echo', { text: 'extra' }, 99))
    expect(r4.action).toBe('block')
    if (r4.action === 'block') {
      expect(r4.response.error.message).toContain('max iterations')
    }
  })

  it('records result and updates stats', async () => {
    const config = makeConfig({ tools: { echo: { estimated_tokens: 5 } } })
    traceFiles.push(config.tracePath)
    const ti = new ToolInterceptor(config, config.tracePath)

    await ti.intercept(makeCallMsg('echo', { text: 'x' }, 1))
    ti.recordResult('echo', 1, { content: [{ type: 'text', text: 'x' }] })

    const stats = ti.getStats()
    expect(stats.totalCalls).toBe(1)
    expect(stats.totalTokens).toBeGreaterThan(0)
    expect(stats.blockedCalls).toBe(0)
  })

  it('getStats increments blockedCalls on block', async () => {
    const config = makeConfig({
      maxTokensPerRun: 5,
      tools: { query: { estimated_tokens: 10 } },
    })
    traceFiles.push(config.tracePath)
    const ti = new ToolInterceptor(config, config.tracePath)

    await ti.intercept(makeCallMsg('query', {}, 1))

    const stats = ti.getStats()
    expect(stats.blockedCalls).toBe(1)
  })

  it('setAvailableTools does not block unknown tools', async () => {
    const config = makeConfig({ maxTokensPerRun: 100 })
    traceFiles.push(config.tracePath)
    const ti = new ToolInterceptor(config, config.tracePath)
    ti.setAvailableTools([{ name: 'echo', description: '', inputSchema: {} }])

    // 'mystery_tool' not in tools/list — should still forward
    const r = await ti.intercept(makeCallMsg('mystery_tool', { x: 1 }, 1))
    expect(r.action).toBe('forward')
  })

  it('blocks when max_calls_per_run is exceeded', async () => {
    const config = makeConfig({
      maxTokensPerRun: 100,
      tools: { echo: { estimated_tokens: 10, max_calls_per_run: 2 } },
    })
    traceFiles.push(config.tracePath)
    const ti = new ToolInterceptor(config, config.tracePath)

    const r1 = await ti.intercept(makeCallMsg('echo', { text: 'a' }, 1))
    const r2 = await ti.intercept(makeCallMsg('echo', { text: 'b' }, 2))
    const r3 = await ti.intercept(makeCallMsg('echo', { text: 'c' }, 3))

    expect(r1.action).toBe('forward')
    expect(r2.action).toBe('forward')
    expect(r3.action).toBe('block')
    if (r3.action === 'block') {
      expect(r3.response.error.message).toContain('max calls per run')
    }
  })
})
