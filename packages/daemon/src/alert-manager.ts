import type { AlertConfig, Alert } from './types.js'

export interface AlertInput {
  type: string
  severity: 'warning' | 'action' | 'critical'
  message: string
  details?: Record<string, unknown>
}

/**
 * Emits alerts to stderr and optional webhook endpoints.
 * Deduplicates identical alerts within a configurable window.
 */
export class AlertManager {
  private static readonly WEBHOOK_TIMEOUT_MS = 10_000
  /** key -> timestamp of last emission */
  private readonly recentKeys = new Map<string, number>()
  private readonly history: Alert[] = []

  constructor(private readonly config: AlertConfig = { dedupWindowMs: 60_000, webhookUrls: [] }) {}

  /**
   * Emit an alert. Deduplicates within dedupWindowMs window.
   *
   * @param input - Alert payload.
   */
  emit(input: AlertInput): void {
    const key = `${input.type}:${input.message}`
    const now = Date.now()

    const last = this.recentKeys.get(key)
    if (last !== undefined && now - last < this.config.dedupWindowMs) {
      return // deduplicated
    }
    this.recentKeys.set(key, now)

    const alert: Alert = {
      id: `alert_${now}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date(now).toISOString(),
      type: input.type,
      severity: input.severity,
      message: input.message,
      details: input.details ?? {},
    }

    this.history.push(alert)
    this._writeStderr(alert)
    this._fireWebhooks(alert)
  }

  /**
   * Returns the alert history (most recent first).
   */
  getHistory(limit = 100): Alert[] {
    return this.history.slice(-limit).reverse()
  }

  /**
   * Clear dedup cache (useful for testing).
   */
  clearDedup(): void {
    this.recentKeys.clear()
  }

  private _writeStderr(alert: Alert): void {
    process.stderr.write(
      `[fuze-daemon] ${alert.severity.toUpperCase()} ${alert.type}: ${alert.message}\n`,
    )
  }

  private _fireWebhooks(alert: Alert): void {
    for (const url of this.config.webhookUrls ?? []) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), AlertManager.WEBHOOK_TIMEOUT_MS)

      void fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(alert),
        signal: controller.signal,
      })
        .catch(() => {
          // Webhook failures are silent - don't disrupt the daemon
        })
        .finally(() => {
          clearTimeout(timeout)
        })
    }
  }
}
