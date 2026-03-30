/**
 * No-op service — used when neither daemon nor cloud is configured.
 * All operations succeed instantly; step checks always return 'proceed';
 * tool config is never fetched (SDK uses local defaults).
 */
export class NoopService {
    async connect() { return true; }
    disconnect() { }
    isConnected() { return true; }
    async registerTools(_projectId, _tools) { }
    getToolConfig(_toolName) { return null; }
    async refreshConfig() { }
    async sendRunStart(_runId, _agentId, _config) { }
    async sendStepStart(_runId, _step) {
        return 'proceed';
    }
    async sendStepEnd(_runId, _stepId, _data) { }
    async sendGuardEvent(_runId, _event) { }
    async sendRunEnd(_runId, _status, _totalCost) { }
}
//# sourceMappingURL=noop-service.js.map