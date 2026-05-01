type Resolver<T> = (value: T) => void

export class LongPollHub<T> {
  private readonly waiters = new Map<string, Set<Resolver<T>>>()

  wait(key: string, timeoutMs: number): Promise<T | null> {
    if (timeoutMs <= 0) return Promise.resolve(null)
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

  notify(key: string, value: T): number {
    const set = this.waiters.get(key)
    if (!set) return 0
    const count = set.size
    for (const resolver of Array.from(set)) {
      resolver(value)
    }
    return count
  }

  pendingFor(key: string): number {
    return this.waiters.get(key)?.size ?? 0
  }
}
