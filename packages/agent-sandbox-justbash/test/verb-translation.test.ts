import { describe, expect, it } from 'vitest'
import {
  makePrincipalId,
  makeRunId,
  makeStepId,
  makeTenantId,
  type Ctx,
} from '@fuze-ai/agent'
import { JustBashSandbox, RealBashFactory } from '../src/index.js'

const buildCtx = (tenant: string, runId: string): Ctx<unknown> => ({
  tenant: makeTenantId(tenant),
  principal: makePrincipalId('p'),
  runId: makeRunId(runId),
  stepId: makeStepId('s'),
  deps: {},
  secrets: {
    ref: () => {
      throw new Error('not used')
    },
    resolve: async () => '',
  },
  attribute: () => undefined,
  invoke: async () => {
    throw new Error('not used')
  },
})

const make = (): JustBashSandbox =>
  new JustBashSandbox({ factory: new RealBashFactory() })

describe('JustBashSandbox verb translation against RealBashFactory', () => {
  it('write_file then read_file roundtrips bytes', async () => {
    const sb = make()
    const ctx = buildCtx('t-rw', 'r-rw')
    const w = await sb.exec(
      { command: 'write_file /tmp/a.txt', stdin: 'hello-world' },
      ctx,
    )
    expect(w.exitCode).toBe(0)
    expect(w.stdout).toBe('11')
    const r = await sb.exec({ command: 'read_file /tmp/a.txt' }, ctx)
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toBe('hello-world')
  })

  it('read_file on missing path returns nonzero exit', async () => {
    const sb = make()
    const ctx = buildCtx('t-miss', 'r-miss')
    const r = await sb.exec({ command: 'read_file /tmp/nope.txt' }, ctx)
    expect(r.exitCode).not.toBe(0)
  })

  it('list_files returns newline-separated entries of a directory', async () => {
    const sb = make()
    const ctx = buildCtx('t-ls', 'r-ls')
    await sb.exec({ command: 'write_file /work/a.txt', stdin: 'a' }, ctx)
    await sb.exec({ command: 'write_file /work/b.txt', stdin: 'b' }, ctx)
    const r = await sb.exec({ command: 'list_files /work' }, ctx)
    expect(r.exitCode).toBe(0)
    const entries = r.stdout.split('\n').filter((s) => s.length > 0).sort()
    expect(entries).toEqual(['a.txt', 'b.txt'])
  })

  it('grep returns JSON envelope with matches across files', async () => {
    const sb = make()
    const ctx = buildCtx('t-grep', 'r-grep')
    await sb.exec({ command: 'write_file /src/a.ts', stdin: 'TODO: one\nok\n' }, ctx)
    await sb.exec({ command: 'write_file /src/b.ts', stdin: 'no\nTODO: two\n' }, ctx)
    const r = await sb.exec(
      { command: 'grep', stdin: JSON.stringify({ pattern: 'TODO', path: '/src' }) },
      ctx,
    )
    expect(r.exitCode).toBe(0)
    const env = JSON.parse(r.stdout) as {
      matches: Array<{ path: string; line: number; text: string }>
      truncated: boolean
    }
    expect(env.truncated).toBe(false)
    const sorted = env.matches.slice().sort((a, b) => a.path.localeCompare(b.path))
    expect(sorted).toEqual([
      { path: '/src/a.ts', line: 1, text: 'TODO: one' },
      { path: '/src/b.ts', line: 2, text: 'TODO: two' },
    ])
  })

  it('grep with bad stdin returns exit 2', async () => {
    const sb = make()
    const ctx = buildCtx('t-gbad', 'r-gbad')
    const r = await sb.exec({ command: 'grep', stdin: 'not-json' }, ctx)
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toBe('grep-bad-stdin')
  })

  it('glob returns matching paths under a root', async () => {
    const sb = make()
    const ctx = buildCtx('t-glob', 'r-glob')
    await sb.exec({ command: 'write_file /pkg/a.ts', stdin: 'x' }, ctx)
    await sb.exec({ command: 'write_file /pkg/b.md', stdin: 'y' }, ctx)
    const r = await sb.exec(
      {
        command: 'glob',
        stdin: JSON.stringify({ pattern: '*.ts', path: '/pkg' }),
      },
      ctx,
    )
    expect(r.exitCode).toBe(0)
    const env = JSON.parse(r.stdout) as { paths: string[]; truncated: boolean }
    expect(env.truncated).toBe(false)
    expect(env.paths).toEqual(['/pkg/a.ts'])
  })

  it('edit replaces occurrences and returns envelope', async () => {
    const sb = make()
    const ctx = buildCtx('t-edit', 'r-edit')
    await sb.exec({ command: 'write_file /e/f.txt', stdin: 'hello hello' }, ctx)
    const r = await sb.exec(
      {
        command: 'edit',
        stdin: JSON.stringify({
          path: '/e/f.txt',
          oldString: 'hello',
          newString: 'world',
          expectedOccurrences: 2,
        }),
      },
      ctx,
    )
    expect(r.exitCode).toBe(0)
    const env = JSON.parse(r.stdout) as {
      occurrencesReplaced: number
      bytesWritten: number
    }
    expect(env.occurrencesReplaced).toBe(2)
    expect(env.bytesWritten).toBe('world world'.length)
    const after = await sb.exec({ command: 'read_file /e/f.txt' }, ctx)
    expect(after.stdout).toBe('world world')
  })

  it('edit on missing file returns edit-no-such-file', async () => {
    const sb = make()
    const ctx = buildCtx('t-emiss', 'r-emiss')
    const r = await sb.exec(
      {
        command: 'edit',
        stdin: JSON.stringify({
          path: '/missing.txt',
          oldString: 'a',
          newString: 'b',
        }),
      },
      ctx,
    )
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toBe('edit-no-such-file:/missing.txt')
  })

  it('edit with mismatched occurrence count refuses', async () => {
    const sb = make()
    const ctx = buildCtx('t-emm', 'r-emm')
    await sb.exec({ command: 'write_file /e2.txt', stdin: 'aaa' }, ctx)
    const r = await sb.exec(
      {
        command: 'edit',
        stdin: JSON.stringify({
          path: '/e2.txt',
          oldString: 'a',
          newString: 'b',
          expectedOccurrences: 1,
        }),
      },
      ctx,
    )
    expect(r.exitCode).toBe(1)
    expect(r.stderr).toBe('edit-occurrence-mismatch:expected=1:actual=3')
  })

  it('falls through to bash for unrecognised commands', async () => {
    const sb = make()
    const ctx = buildCtx('t-pass', 'r-pass')
    const r = await sb.exec({ command: 'echo hello' }, ctx)
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('hello')
  })

  it('extended fetch verb routes method+headers+body through wrappedFetch', async () => {
    const seen: Array<{ url: string; method: string }> = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const u = typeof url === 'string' ? url : (url as URL).toString()
      const method = init?.method ?? 'GET'
      seen.push({ url: u, method })
      return new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    try {
      const onFetchCalls: Array<{ url: string; method: string }> = []
      const sb = new JustBashSandbox({
        factory: new RealBashFactory(),
        allowedFetchPrefixes: ['https://api.example.com/'],
        onFetch: (e) => {
          onFetchCalls.push({ url: e.url, method: e.method })
        },
      })
      const ctx = buildCtx('t-fx2', 'r-fx2')
      const r = await sb.exec(
        {
          command: 'fetch',
          stdin: JSON.stringify({
            url: 'https://api.example.com/v1/search?q=hi',
            method: 'POST',
            headers: { 'X-Token': 'secret' },
            body: '{"q":"hi"}',
          }),
        },
        ctx,
      )
      expect(r.exitCode).toBe(0)
      const env = JSON.parse(r.stdout) as { status: number; body: string }
      expect(env.status).toBe(200)
      expect(seen).toEqual([
        { url: 'https://api.example.com/v1/search?q=hi', method: 'POST' },
      ])
      expect(onFetchCalls).toEqual([
        { url: 'https://api.example.com/v1/search?q=hi', method: 'POST' },
      ])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('legacy fetch verb (URL appended) still works', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (): Promise<Response> => {
      return new Response('legacy-ok', { status: 200 })
    }) as typeof fetch
    try {
      const sb = new JustBashSandbox({
        factory: new RealBashFactory(),
        allowedFetchPrefixes: ['https://api.example.com/'],
      })
      const ctx = buildCtx('t-fx-legacy', 'r-fx-legacy')
      const r = await sb.exec(
        { command: 'fetch https://api.example.com/v1/ping' },
        ctx,
      )
      expect(r.exitCode).toBe(0)
      const env = JSON.parse(r.stdout) as { status: number; body: string }
      expect(env.status).toBe(200)
      expect(env.body).toBe('legacy-ok')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('extended fetch verb refuses non-allowlisted hosts', async () => {
    const originalFetch = globalThis.fetch
    let called = false
    globalThis.fetch = (async (): Promise<Response> => {
      called = true
      return new Response('should-not-be-called')
    }) as typeof fetch
    try {
      const sb = new JustBashSandbox({
        factory: new RealBashFactory(),
        allowedFetchPrefixes: ['https://api.example.com/'],
      })
      const ctx = buildCtx('t-fx-deny', 'r-fx-deny')
      const r = await sb.exec(
        {
          command: 'fetch',
          stdin: JSON.stringify({ url: 'https://evil.test/leak', method: 'GET' }),
        },
        ctx,
      )
      expect(r.exitCode).toBe(1)
      expect(r.stderr).toContain('fetch denied')
      expect(called).toBe(false)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('extended fetch verb with bad stdin returns exit 2', async () => {
    const sb = make()
    const ctx = buildCtx('t-fx-bad', 'r-fx-bad')
    const r = await sb.exec({ command: 'fetch', stdin: 'not-json' }, ctx)
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toBe('fetch-bad-stdin')
  })
})
