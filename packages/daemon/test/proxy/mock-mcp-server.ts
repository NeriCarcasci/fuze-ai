#!/usr/bin/env node
/**
 * Minimal mock MCP server for proxy integration tests.
 *
 * Responds to: initialize, notifications/initialized, tools/list, tools/call
 * Run as: node --import tsx/esm test/proxy/mock-mcp-server.ts
 */
import { createInterface } from 'node:readline'

const TOOLS = [
  {
    name: 'echo',
    description: 'Echo input text',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  },
  {
    name: 'fail',
    description: 'Always returns an error',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'slow',
    description: 'Takes 2 seconds to respond',
    inputSchema: { type: 'object', properties: {} },
  },
]

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })

rl.on('line', (line: string) => {
  const trimmed = line.trim()
  if (!trimmed) return

  let msg: Record<string, unknown>
  try {
    msg = JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    return
  }

  const method = msg['method'] as string | undefined
  const id = msg['id'] as number | string | undefined
  const params = msg['params'] as Record<string, unknown> | undefined

  if (method === 'initialize') {
    respond(id!, {
      protocolVersion: '2025-03-26',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'mock-server', version: '1.0.0' },
    })
  } else if (method === 'notifications/initialized') {
    // Notification — no response
  } else if (method === 'tools/list') {
    respond(id!, { tools: TOOLS })
  } else if (method === 'tools/call') {
    const name = (params?.['name'] as string) ?? ''
    const args = (params?.['arguments'] as Record<string, unknown>) ?? {}

    if (name === 'echo') {
      respond(id!, { content: [{ type: 'text', text: String(args['text'] ?? '') }] })
    } else if (name === 'fail') {
      respondError(id!, -1, 'Intentional failure from mock server')
    } else if (name === 'slow') {
      setTimeout(() => {
        respond(id!, { content: [{ type: 'text', text: 'slow response done' }] })
      }, 200)
    } else {
      respond(id!, { content: [{ type: 'text', text: `unknown tool: ${name}` }] })
    }
  } else if (id !== undefined) {
    // Unknown request with id — return empty result
    respond(id, {})
  }
  // Notifications without id: no response
})

function respond(id: number | string, result: unknown): void {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
}

function respondError(id: number | string, code: number, message: string): void {
  process.stdout.write(
    JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n',
  )
}
