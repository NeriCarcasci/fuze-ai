/**
 * Emits alerts to stderr and optional webhook endpoints.
 * Deduplicates identical alerts within a configurable window.
 */
export class AlertManager {
    config;
    /** key → timestamp of last emission */
    recentKeys = new Map();
    history = [];
    constructor(config = { dedupWindowMs: 60_000, webhookUrls: [] }) {
        this.config = config;
    }
    /**
     * Emit an alert. Deduplicates within dedupWindowMs window.
     *
     * @param input - Alert payload.
     */
    emit(input) {
        const key = `${input.type}:${input.message}`;
        const now = Date.now();
        const last = this.recentKeys.get(key);
        if (last !== undefined && now - last < this.config.dedupWindowMs) {
            return; // deduplicated
        }
        this.recentKeys.set(key, now);
        const alert = {
            id: `alert_${now}_${Math.random().toString(36).slice(2, 8)}`,
            timestamp: new Date(now).toISOString(),
            type: input.type,
            severity: input.severity,
            message: input.message,
            details: input.details ?? {},
        };
        this.history.push(alert);
        this._writeStderr(alert);
        this._fireWebhooks(alert);
    }
    /**
     * Returns the alert history (most recent first).
     */
    getHistory(limit = 100) {
        return this.history.slice(-limit).reverse();
    }
    /**
     * Clear dedup cache (useful for testing).
     */
    clearDedup() {
        this.recentKeys.clear();
    }
    // ── Private ──────────────────────────────────────────────────────────────
    _writeStderr(alert) {
        process.stderr.write(`[fuze-daemon] ${alert.severity.toUpperCase()} ${alert.type}: ${alert.message}\n`);
    }
    _fireWebhooks(alert) {
        for (const url of this.config.webhookUrls ?? []) {
            fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(alert),
            }).catch(() => {
                // Webhook failures are silent — don't disrupt the daemon
            });
        }
    }
}
//# sourceMappingURL=alert-manager.js.map