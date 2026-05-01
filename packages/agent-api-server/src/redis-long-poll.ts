type Resolver<T> = (value: T) => void

const CHANNEL_PREFIX = 'fuze:longpoll:'

export interface IoRedisLikeClient {
  publish(channel: string, message: string): Promise<number> | number
  subscribe(channel: string): Promise<unknown> | unknown
  on(event: 'message', listener: (channel: string, message: string) => void): unknown
  quit(): Promise<unknown> | unknown
  duplicate?(): IoRedisLikeClient
}

export interface RedisLongPollHubOptions {
  readonly redisUrl: string
  readonly redis?: IoRedisLikeClient
  readonly subscriber?: IoRedisLikeClient
  readonly loadIoRedis?: () => Promise<{
    default: new (url: string) => IoRedisLikeClient
  }>
}

const defaultLoader = async (): Promise<{
  default: new (url: string) => IoRedisLikeClient
}> => {
  const moduleName = 'ioredis'
  try {
    const mod = (await import(moduleName)) as unknown as {
      default?: new (url: string) => IoRedisLikeClient
      Redis?: new (url: string) => IoRedisLikeClient
    }
    const ctor = mod.default ?? mod.Redis
    if (!ctor) {
      throw new Error('ioredis: no default export found')
    }
    return { default: ctor }
  } catch (e) {
    throw new Error(
      'RedisLongPollHub requires ioredis as an optional peer dependency; install it with `npm i ioredis`',
      { cause: e },
    )
  }
}

export class RedisLongPollHub<T> {
  private readonly waiters = new Map<string, Set<Resolver<T>>>()
  private readonly publisher: IoRedisLikeClient
  private readonly subscriber: IoRedisLikeClient
  private readonly subscribedChannels = new Set<string>()
  private disposed = false

  private constructor(publisher: IoRedisLikeClient, subscriber: IoRedisLikeClient) {
    this.publisher = publisher
    this.subscriber = subscriber
    subscriber.on('message', (channel, message) => {
      if (!channel.startsWith(CHANNEL_PREFIX)) return
      const key = channel.slice(CHANNEL_PREFIX.length)
      let value: T
      try {
        value = JSON.parse(message) as T
      } catch {
        return
      }
      this.deliverLocal(key, value)
    })
  }

  static async create<T>(opts: RedisLongPollHubOptions): Promise<RedisLongPollHub<T>> {
    const explicitPub = opts.redis
    const explicitSub = opts.subscriber
    if (explicitPub && explicitSub) {
      return new RedisLongPollHub<T>(explicitPub, explicitSub)
    }

    const loader = opts.loadIoRedis ?? defaultLoader
    const mod = await loader()
    const Ctor = mod.default
    const publisher = explicitPub ?? new Ctor(opts.redisUrl)
    const subscriber =
      explicitSub ??
      (publisher.duplicate ? publisher.duplicate() : new Ctor(opts.redisUrl))
    return new RedisLongPollHub<T>(publisher, subscriber)
  }

  async wait(key: string, timeoutMs: number): Promise<T | null> {
    if (this.disposed) return null
    if (timeoutMs <= 0) return null
    await this.ensureSubscribed(key)
    return new Promise<T | null>((resolve) => {
      const set = this.waiters.get(key) ?? new Set<Resolver<T>>()
      const resolver: Resolver<T | null> = (value) => {
        clearTimeout(timer)
        const current = this.waiters.get(key)
        if (current) {
          current.delete(resolver as Resolver<T>)
          if (current.size === 0) this.waiters.delete(key)
        }
        resolve(value)
      }
      const timer = setTimeout(() => resolver(null), timeoutMs)
      set.add(resolver as Resolver<T>)
      this.waiters.set(key, set)
    })
  }

  async notify(key: string, value: T): Promise<number> {
    if (this.disposed) return 0
    const channel = CHANNEL_PREFIX + key
    await Promise.resolve(this.publisher.publish(channel, JSON.stringify(value)))
    return this.waiters.get(key)?.size ?? 0
  }

  pendingFor(key: string): number {
    return this.waiters.get(key)?.size ?? 0
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    for (const set of this.waiters.values()) {
      for (const resolver of set) {
        resolver(null as unknown as T)
      }
    }
    this.waiters.clear()
    await Promise.resolve(this.subscriber.quit())
    await Promise.resolve(this.publisher.quit())
  }

  private deliverLocal(key: string, value: T): void {
    const set = this.waiters.get(key)
    if (!set) return
    for (const resolver of Array.from(set)) {
      resolver(value)
    }
  }

  private async ensureSubscribed(key: string): Promise<void> {
    const channel = CHANNEL_PREFIX + key
    if (this.subscribedChannels.has(channel)) return
    this.subscribedChannels.add(channel)
    await Promise.resolve(this.subscriber.subscribe(channel))
  }
}
