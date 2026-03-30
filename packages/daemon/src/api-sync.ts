/**
 * ApiSync — pulls tool configs from the Fuze cloud API every 30 seconds
 * and writes them into the local ConfigCache. Active only when FUZE_API_KEY
 * is set in the environment or passed explicitly.
 */
import type { ConfigCache } from './config-cache.js'
import type { ToolConfig } from './protocol.js'

const SYNC_INTERVAL_MS = 30_000
const FETCH_TIMEOUT_MS = 10_000

export class ApiSync {
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly apiKey: string,
    private readonly endpoint: string,
    private readonly configCache: ConfigCache,
    private readonly projectId: string,
  ) {}

  /** Start the sync loop. Initial pull runs immediately. */
  start(): void {
    void this._pull()
    this.timer = setInterval(() => void this._pull(), SYNC_INTERVAL_MS)
    // Don't keep the process alive just for syncing
    ;(this.timer as NodeJS.Timeout).unref()
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async _pull(): Promise<void> {
    try {
      const res = await fetch(`${this.endpoint}/v1/tools/config`, {
        headers: { 'x-api-key': this.apiKey },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (!res.ok) return

      const body = await res.json() as { tools?: Record<string, ToolConfig> }
      if (body.tools && typeof body.tools === 'object') {
        this.configCache.setToolConfigs(this.projectId, body.tools)
        this.configCache.setSyncState('last_synced_at', new Date().toISOString())
      }
    } catch {
      // Network error or timeout — keep serving the stale cache
    }
  }
}
