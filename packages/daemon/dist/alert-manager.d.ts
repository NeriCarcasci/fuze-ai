import type { AlertConfig, Alert } from './types.js';
export interface AlertInput {
    type: string;
    severity: 'warning' | 'action' | 'critical';
    message: string;
    details?: Record<string, unknown>;
}
/**
 * Emits alerts to stderr and optional webhook endpoints.
 * Deduplicates identical alerts within a configurable window.
 */
export declare class AlertManager {
    private readonly config;
    /** key → timestamp of last emission */
    private readonly recentKeys;
    private readonly history;
    constructor(config?: AlertConfig);
    /**
     * Emit an alert. Deduplicates within dedupWindowMs window.
     *
     * @param input - Alert payload.
     */
    emit(input: AlertInput): void;
    /**
     * Returns the alert history (most recent first).
     */
    getHistory(limit?: number): Alert[];
    /**
     * Clear dedup cache (useful for testing).
     */
    clearDedup(): void;
    private _writeStderr;
    private _fireWebhooks;
}
//# sourceMappingURL=alert-manager.d.ts.map