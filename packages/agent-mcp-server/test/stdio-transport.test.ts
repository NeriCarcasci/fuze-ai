import { Readable, Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { StdioMcpServerTransport } from '../src/stdio-transport.js'
import { JSON_RPC_ERR, type JsonRpcRequest, type JsonRpcResponse } from '../src/types.js'

const makeStdin = (lines: string[]): Readable => {
  const r = new Readable({ read() {} })
  for (const line of lines) r.push(`${line}\n`)
  r.push(null)
  return r
}

class CapturingWritable extends Writable {
  readonly chunks: string[] = []
  override _write(chunk: Buffer | string, _enc: BufferEncoding, cb: (err?: Error | null) => void): void {
    this.chunks.push(chunk.toString())
    cb()
  }
}

const flush = () => new Promise<void>((res) => setImmediate(res))

describe('StdioMcpServerTransport', () => {
  it('reads newline-delimited JSON from stdin and writes responses to stdout', async () => {
    const stdin = makeStdin([
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' } satisfies JsonRpcRequest),
    ])
    const stdout = new CapturingWritable()
    const transport = new StdioMcpServerTransport({ stdin, stdout })

    const handler = async (req: JsonRpcRequest): Promise<JsonRpcResponse> => ({
      jsonrpc: '2.0',
      id: req.id,
      result: { ok: true, method: req.method },
    })

    await transport.start(handler)
    await flush()
    await flush()

    expect(stdout.chunks.length).toBeGreaterThan(0)
    const written = stdout.chunks.join('')
    const parsed = JSON.parse(written.trim()) as JsonRpcResponse
    expect(parsed.id).toBe(1)
    expect(parsed.result).toEqual({ ok: true, method: 'ping' })

    await transport.stop()
  })

  it('emits a ParseError response for invalid JSON input', async () => {
    const stdin = makeStdin(['{ not json'])
    const stdout = new CapturingWritable()
    const transport = new StdioMcpServerTransport({ stdin, stdout })

    const handler = async (): Promise<JsonRpcResponse> => {
      throw new Error('handler should not be called for malformed input')
    }

    await transport.start(handler)
    await flush()
    await flush()

    const written = stdout.chunks.join('').trim()
    expect(written.length).toBeGreaterThan(0)
    const parsed = JSON.parse(written) as JsonRpcResponse
    expect(parsed.error?.code).toBe(JSON_RPC_ERR.ParseError)
    expect(parsed.id).toBeNull()

    await transport.stop()
  })

  it('skips blank lines without error', async () => {
    const stdin = makeStdin([
      '',
      '   ',
      JSON.stringify({ jsonrpc: '2.0', id: 'x', method: 'noop' } satisfies JsonRpcRequest),
    ])
    const stdout = new CapturingWritable()
    const transport = new StdioMcpServerTransport({ stdin, stdout })

    let calls = 0
    const handler = async (req: JsonRpcRequest): Promise<JsonRpcResponse> => {
      calls++
      return { jsonrpc: '2.0', id: req.id, result: { n: calls } }
    }

    await transport.start(handler)
    await flush()
    await flush()

    expect(calls).toBe(1)
    const written = stdout.chunks.join('').trim().split('\n')
    expect(written).toHaveLength(1)
    const parsed = JSON.parse(written[0]!) as JsonRpcResponse
    expect(parsed.id).toBe('x')

    await transport.stop()
  })
})
