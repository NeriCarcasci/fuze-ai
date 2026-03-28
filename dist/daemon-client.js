/**
 * Stub client for the Fuze runtime daemon (Phase 3).
 * Always returns "proceed" in Phase 1.
 */
export class DaemonClient {
    /**
     * Checks with the daemon whether to proceed with the current step.
     * In Phase 1, this always returns { action: 'proceed' }.
     * @param _runId - The run identifier (unused in stub).
     * @param _stepId - The step identifier (unused in stub).
     * @returns Always resolves with { action: 'proceed' }.
     */
    async check(_runId, _stepId) {
        return { action: 'proceed' };
    }
}
//# sourceMappingURL=daemon-client.js.map