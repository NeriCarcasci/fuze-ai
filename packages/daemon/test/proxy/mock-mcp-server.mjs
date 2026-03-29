#!/usr/bin/env node
/**
 * Plain JavaScript mock MCP server for proxy integration tests.
 * Run as: node test/proxy/mock-mcp-server.mjs
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
    description: 'Takes 200ms to respond',
    inputSchema: { type: 'object', properties: {} },
  },
]

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })

rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return

  let msg
  try {
    msg = JSON.parse(trimmed)
  } catch {
    return
  }

  const { method, id, params } = msg

  if (method === 'initialize') {
    respond(id, {
      protocolVersion: '2025-03-26',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'mock-server', version: '1.0.0' },
    })
  } else if (method === 'notifications/initialized') {
    // Notification — no response
  } else if (method === 'tools/list') {
    respond(id, { tools: TOOLS })
  } else if (method === 'tools/call') {
    const name = params?.name ?? ''
    const args = params?.arguments ?? {}

    if (name === 'echo') {
      respond(id, { content: [{ type: 'text', text: String(args.text ?? '') }] })
    } else if (name === 'fail') {
      respondError(id, -1, 'Intentional failure from mock server')
    } else if (name === 'slow') {
      setTimeout(() => {
        respond(id, { content: [{ type: 'text', text: 'slow response done' }] })
      }, 200)
    } else {
      respond(id, { content: [{ type: 'text', text: `unknown tool: ${name}` }] })
    }
  } else if (id !== undefined) {
    // Unknown request with id — return empty result
    respond(id, {})
  }
})

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
}

function respondError(id, code, message) {
  process.stdout.write(
    JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n',
  )
}
