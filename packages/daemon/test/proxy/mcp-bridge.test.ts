import { describe, it, expect, afterEach } from 'vitest'
import { MCPBridge } from '../../src/proxy/mcp-bridge.js'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MOCK_SERVER = path.join(__dirname, 'mock-mcp-server.mjs')

function makeBridge(): MCPBridge {
  return new MCPBridge('node', [MOCK_SERVER])
}

describe('MCPBridge', () => {
  const bridges: MCPBridge[] = []

  afterEach(async () => {
    for (const b of bridges) {
      await b.stop().catch(() => {})
    }
    bridges.length = 0
  })

  it('starts without throwing and isAlive() returns true', async () => {
    const b = makeBridge()
    bridges.push(b)
    await b.start()
    expect(b.isAlive()).toBe(true)
  })

  it('sendToServer + onServerMessage: round-trip tools/list', async () => {
    const b = makeBridge()
    bridges.push(b)
    await b.start()

    const messages: unknown[] = []
    b.onServerMessage((msg) => messages.push(msg))

    b.sendToServer({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0' },
    }})

    await new Promise((r) => setTimeout(r, 300))

    const initResp = messages.find((m) => (m as { id: unknown }).id === 1)
    expect(initResp).toBeTruthy()

    b.sendToServer({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    await new Promise((r) => setTimeout(r, 300))

    const listResp = messages.find((m) => (m as { id: unknown }).id === 2) as {
      result: { tools: { name: string }[] }
    }
    expect(listResp?.result?.tools).toBeInstanceOf(Array)
    expect(listResp.result.tools.some((t) => t.name === 'echo')).toBe(true)
  })

  it('onServerExit fires when server process exits', async () => {
    // Spawn a process that exits immediately
    const b = new MCPBridge('node', ['-e', 'process.exit(42)'])
    bridges.push(b)

    let exitCode: number | null = null
    b.onServerExit((code) => { exitCode = code })

    await b.start()
    await new Promise((r) => setTimeout(r, 500))

    expect(exitCode).toBe(42)
    expect(b.isAlive()).toBe(false)
  })

  it('stop() terminates the server', async () => {
    const b = makeBridge()
    bridges.push(b)
    await b.start()
    expect(b.isAlive()).toBe(true)
    await b.stop()
    expect(b.isAlive()).toBe(false)
  })

  it('sendToServer after stop() does not throw', async () => {
    const b = makeBridge()
    bridges.push(b)
    await b.start()
    await b.stop()
    expect(() =>
      b.sendToServer({ jsonrpc: '2.0', id: 99, method: 'tools/list' }),
    ).not.toThrow()
  })

  it('handles multiple messages in rapid succession', async () => {
    const b = makeBridge()
    bridges.push(b)
    await b.start()

    const messages: unknown[] = []
    b.onServerMessage((msg) => messages.push(msg))

    // Send initialize first
    b.sendToServer({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' },
    }})
    await new Promise((r) => setTimeout(r, 200))

    // Send 5 tools/call messages
    for (let i = 2; i <= 6; i++) {
      b.sendToServer({
        jsonrpc: '2.0', id: i, method: 'tools/call',
        params: { name: 'echo', arguments: { text: `msg-${i}` } },
      })
    }

    await new Promise((r) => setTimeout(r, 500))
    const echoResps = messages.filter(
      (m) => {
        const r = m as { id: unknown; result?: { content?: unknown[] } }
        return r.result?.content !== undefined && (r.id as number) >= 2
      },
    )
    expect(echoResps.length).toBeGreaterThanOrEqual(5)
  })
}, 30000)
