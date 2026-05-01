import type { ResumeTokenStore } from '../types/oversight.js'

export class InMemoryNonceStore implements ResumeTokenStore {
  private readonly seen = new Set<string>()

  async has(nonce: string): Promise<boolean> {
    return this.seen.has(nonce)
  }

  async consume(nonce: string): Promise<void> {
    this.seen.add(nonce)
  }
}
