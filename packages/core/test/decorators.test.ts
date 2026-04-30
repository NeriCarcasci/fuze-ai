import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { guardMethod, guarded, guardAll, configure, resetConfig } from '../src/index.js'
import { unlinkSync, existsSync, readFileSync } from 'node:fs'

// Unique per test file so vitest's parallel file execution doesn't race
// other tests that also write to the SDK's default trace path.
const TRACE_FILE = './fuze-traces-decorators.jsonl'

function readTraceLines(): Record<string, unknown>[] {
  if (!existsSync(TRACE_FILE)) return []
  return readFileSync(TRACE_FILE, 'utf-8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

beforeEach(() => {
  configure({ defaults: { traceOutput: TRACE_FILE } })
  if (existsSync(TRACE_FILE)) {
    try { unlinkSync(TRACE_FILE) } catch { /* ok */ }
  }
})

afterEach(() => {
  resetConfig()
  if (existsSync(TRACE_FILE)) {
    try { unlinkSync(TRACE_FILE) } catch { /* ok */ }
  }
})

describe('@guardMethod', () => {
  it('wraps an async method on a class and returns its result', async () => {
    class Agent {
      @guardMethod
      async think(input: string) {
        return `thought: ${input}`
      }
    }

    const a = new Agent()
    const result = await a.think('hi')
    expect(result).toBe('thought: hi')
  })

  it('preserves `this` inside the method', async () => {
    class Counter {
      n = 0

      @guardMethod
      async tick() {
        this.n += 1
        return this.n
      }
    }

    const c = new Counter()
    expect(await c.tick()).toBe(1)
    expect(await c.tick()).toBe(2)
    expect(c.n).toBe(2)
  })

  it('factory form forwards options', async () => {
    let captured: unknown = null
    class Slow {
      @guardMethod({ timeout: 50 })
      async work() {
        return new Promise((resolve) => {
          captured = setTimeout(() => resolve('done'), 1000)
        })
      }
    }

    const s = new Slow()
    await expect(s.work()).rejects.toThrow(/timeout|exceeded/i)
    if (typeof captured === 'object' && captured !== null) clearTimeout(captured as ReturnType<typeof setTimeout>)
  })

  it('records a step in the trace recorder', async () => {
    class Echo {
      @guardMethod
      async say(input: string) {
        return input
      }
    }

    const e = new Echo()
    await e.say('hello')

    const lines = readTraceLines()
    const stepEvents = lines.filter((l) => l['recordType'] === 'step')
    expect(stepEvents.length).toBeGreaterThanOrEqual(1)
  })
})

describe('@guarded class decorator', () => {
  it('wraps every async own-method on the class', async () => {
    @guarded
    class MyAgent {
      async think(x: string) { return `t:${x}` }
      async act(x: string) { return `a:${x}` }
    }

    const a = new MyAgent()
    expect(await a.think('q')).toBe('t:q')
    expect(await a.act('q')).toBe('a:q')
  })

  it('joins internal `this.method()` calls into the same run via async-local storage', async () => {
    @guarded
    class Pipeline {
      async outer(x: string) {
        const stepA = await this.inner(`${x}-a`)
        const stepB = await this.inner(`${x}-b`)
        return [stepA, stepB]
      }

      async inner(x: string) {
        return `inner:${x}`
      }
    }

    const p = new Pipeline()
    const out = await p.outer('hi')
    expect(out).toEqual(['inner:hi-a', 'inner:hi-b'])

    const lines = readTraceLines()
    const stepEvents = lines.filter((l) => l['recordType'] === 'step')
    const runIds = new Set(stepEvents.map((l) => l['runId']))
    expect(runIds.size).toBe(1)
    expect(stepEvents.length).toBe(3)
  })

  it('two external calls produce two distinct runs', async () => {
    @guarded
    class Echo {
      async say(x: string) { return x }
    }

    const e = new Echo()
    await e.say('one')
    await e.say('two')

    const lines = readTraceLines()
    const stepEvents = lines.filter((l) => l['recordType'] === 'step')
    const runIds = new Set(stepEvents.map((l) => l['runId']))
    expect(runIds.size).toBe(2)
  })

  it('skips constructor and inherited methods, wraps only own methods', async () => {
    class Base {
      async fromBase() { return 'base' }
    }

    @guarded
    class Sub extends Base {
      async fromSub() { return 'sub' }
    }

    const s = new Sub()
    expect(await s.fromSub()).toBe('sub')
    expect(await s.fromBase()).toBe('base')
  })

  it('factory form passes options through to wrapped methods', async () => {
    @guarded({ timeout: 50 })
    class Slow {
      async work() {
        return new Promise((resolve) => setTimeout(() => resolve('done'), 1000))
      }
    }
    const s = new Slow()
    await expect(s.work()).rejects.toThrow(/timeout|exceeded/i)
  })

  it('idempotent: applying @guarded twice does not double-wrap', async () => {
    @guarded
    @guarded
    class Echo {
      async say(x: string) { return x }
    }

    const e = new Echo()
    await e.say('once')

    const lines = readTraceLines()
    const stepEvents = lines.filter((l) => l['recordType'] === 'step')
    expect(stepEvents.length).toBe(1)
  })
})

describe('guardAll Proxy', () => {
  it('wraps method calls on a plain object', async () => {
    const agent = {
      async think(x: string) { return `t:${x}` },
      async act(x: string) { return `a:${x}` },
    }

    const wrapped = guardAll(agent)
    expect(await wrapped.think('q')).toBe('t:q')
    expect(await wrapped.act('q')).toBe('a:q')

    const lines = readTraceLines()
    const stepEvents = lines.filter((l) => l['recordType'] === 'step')
    expect(stepEvents.length).toBe(2)
  })

  it('wraps method calls on a class instance', async () => {
    class A {
      async go(x: string) { return x.toUpperCase() }
    }
    const wrapped = guardAll(new A())
    expect(await wrapped.go('hi')).toBe('HI')
  })

  it('passes through non-function properties unchanged', () => {
    const obj = { name: 'agent-1', count: 42, hello: () => 'hi' }
    const wrapped = guardAll(obj)
    expect(wrapped.name).toBe('agent-1')
    expect(wrapped.count).toBe(42)
  })

  it('does not intercept `then` (Proxy is not a thenable)', async () => {
    const obj = { something: () => 'ok' }
    const wrapped = guardAll(obj) as unknown as { then?: unknown }
    expect(wrapped.then).toBeUndefined()
  })

  it('binds inner this.method() calls to the original receiver, not the Proxy', async () => {
    let internalThisIsProxy = false
    const obj = {
      _inner: 'private',
      async outer() {
        const innerThis = this
        await this.inner()
        return innerThis === obj
      },
      async inner() {
        internalThisIsProxy = this !== obj
      },
    }

    const wrapped = guardAll(obj)
    const isOriginal = await wrapped.outer()
    expect(isOriginal).toBe(true)
    expect(internalThisIsProxy).toBe(false)
  })

  it('per-method options apply to the named method only', async () => {
    const obj = {
      async fast() { return 'ok' },
      async slow() {
        return new Promise((resolve) => setTimeout(() => resolve('ok'), 1000))
      },
    }
    const wrapped = guardAll(obj, { slow: { timeout: 50 } })
    await expect(wrapped.slow()).rejects.toThrow(/timeout|exceeded/i)
    expect(await wrapped.fast()).toBe('ok')
  })
})
