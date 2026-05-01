import { describe, expect, it } from 'vitest'
import { LongPollHub } from '../src/long-poll.js'

describe('LongPollHub', () => {
  it('resolves immediately when notify happens before wait timeout', async () => {
    const hub = new LongPollHub<string>()
    const waitPromise = hub.wait('run-1', 1000)
    setTimeout(() => hub.notify('run-1', 'hello'), 10)
    expect(await waitPromise).toBe('hello')
  })

  it('returns null on timeout', async () => {
    const hub = new LongPollHub<string>()
    const result = await hub.wait('run-2', 50)
    expect(result).toBeNull()
  })

  it('notify wakes all waiters on the same key', async () => {
    const hub = new LongPollHub<string>()
    const a = hub.wait('run-3', 1000)
    const b = hub.wait('run-3', 1000)
    setTimeout(() => hub.notify('run-3', 'x'), 10)
    expect(await a).toBe('x')
    expect(await b).toBe('x')
  })

  it('notify on a different key does not wake', async () => {
    const hub = new LongPollHub<string>()
    const wait = hub.wait('run-a', 100)
    hub.notify('run-b', 'wrong-key')
    expect(await wait).toBeNull()
  })

  it('returns null synchronously for non-positive timeout', async () => {
    const hub = new LongPollHub<string>()
    expect(await hub.wait('run-x', 0)).toBeNull()
    expect(await hub.wait('run-x', -1)).toBeNull()
  })
})
