import { describe, expect, it } from 'vitest'
import { RedisLongPollHub, type IoRedisLikeClient } from '../src/redis-long-poll.js'

interface FakeBus {
  publish(channel: string, message: string): void
  subscribe(channel: string, listener: (message: string) => void): void
  unsubscribeAll(): void
}

const makeBus = (): FakeBus => {
  const subs = new Map<string, Set<(message: string) => void>>()
  return {
    publish(channel, message) {
      const set = subs.get(channel)
      if (!set) return
      for (const fn of Array.from(set)) fn(message)
    },
    subscribe(channel, listener) {
      const set = subs.get(channel) ?? new Set()
      set.add(listener)
      subs.set(channel, set)
    },
    unsubscribeAll() {
      subs.clear()
    },
  }
}

const makeFakeRedis = (
  bus: FakeBus,
): { publisher: IoRedisLikeClient; subscriber: IoRedisLikeClient; closed: { pub: boolean; sub: boolean } } => {
  const closed = { pub: false, sub: false }
  let messageListener: ((channel: string, message: string) => void) | null = null
  const publisher: IoRedisLikeClient = {
    publish(channel, message) {
      bus.publish(channel, message)
      return 1
    },
    subscribe() {
      return undefined
    },
    on() {
      return undefined
    },
    quit() {
      closed.pub = true
      return undefined
    },
  }
  const subscriber: IoRedisLikeClient = {
    publish() {
      return 0
    },
    subscribe(channel) {
      bus.subscribe(channel, (message) => {
        if (messageListener) messageListener(channel, message)
      })
      return undefined
    },
    on(event, listener) {
      if (event === 'message') messageListener = listener
      return undefined
    },
    quit() {
      closed.sub = true
      return undefined
    },
  }
  return { publisher, subscriber, closed }
}

describe('RedisLongPollHub', () => {
  it('notify wakes a local waiter on the same instance', async () => {
    const bus = makeBus()
    const { publisher, subscriber } = makeFakeRedis(bus)
    const hub = await RedisLongPollHub.create<{ msg: string }>({
      redisUrl: 'redis://fake',
      redis: publisher,
      subscriber,
    })
    const waitPromise = hub.wait('run-1', 1000)
    setTimeout(() => {
      void hub.notify('run-1', { msg: 'hello' })
    }, 10)
    expect(await waitPromise).toEqual({ msg: 'hello' })
    await hub.dispose()
  })

  it('notify from instance A wakes a waiter on instance B via the shared bus', async () => {
    const bus = makeBus()
    const a = makeFakeRedis(bus)
    const b = makeFakeRedis(bus)
    const hubA = await RedisLongPollHub.create<{ n: number }>({
      redisUrl: 'redis://fake',
      redis: a.publisher,
      subscriber: a.subscriber,
    })
    const hubB = await RedisLongPollHub.create<{ n: number }>({
      redisUrl: 'redis://fake',
      redis: b.publisher,
      subscriber: b.subscriber,
    })
    const waitOnB = hubB.wait('run-2', 1000)
    setTimeout(() => {
      void hubA.notify('run-2', { n: 42 })
    }, 10)
    expect(await waitOnB).toEqual({ n: 42 })
    await hubA.dispose()
    await hubB.dispose()
  })

  it('returns null on timeout when no notify arrives', async () => {
    const bus = makeBus()
    const { publisher, subscriber } = makeFakeRedis(bus)
    const hub = await RedisLongPollHub.create<string>({
      redisUrl: 'redis://fake',
      redis: publisher,
      subscriber,
    })
    expect(await hub.wait('lonely', 30)).toBeNull()
    await hub.dispose()
  })

  it('dispose closes both subscriber and publisher connections', async () => {
    const bus = makeBus()
    const { publisher, subscriber, closed } = makeFakeRedis(bus)
    const hub = await RedisLongPollHub.create<string>({
      redisUrl: 'redis://fake',
      redis: publisher,
      subscriber,
    })
    await hub.dispose()
    expect(closed.pub).toBe(true)
    expect(closed.sub).toBe(true)
  })

  it('throws a clear error when ioredis cannot be loaded and no client is injected', async () => {
    await expect(
      RedisLongPollHub.create<string>({
        redisUrl: 'redis://fake',
        loadIoRedis: async () => {
          throw new Error('Cannot find module ioredis')
        },
      }),
    ).rejects.toThrow(/ioredis/)
  })

  it('returns null synchronously for non-positive timeout', async () => {
    const bus = makeBus()
    const { publisher, subscriber } = makeFakeRedis(bus)
    const hub = await RedisLongPollHub.create<string>({
      redisUrl: 'redis://fake',
      redis: publisher,
      subscriber,
    })
    expect(await hub.wait('k', 0)).toBeNull()
    expect(await hub.wait('k', -1)).toBeNull()
    await hub.dispose()
  })
})
