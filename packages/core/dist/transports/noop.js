/**
 * No-op transport — used when neither daemon nor cloud is configured.
 * All operations succeed instantly; step checks always return 'proceed'.
 */
export class NoopTransport {
    async connect() { return true; }
    async sendRunStart(_runId, _agentId, _config) { }
    async sendStepStart(_runId, _step) {
        return 'proceed';
    }
    async sendStepEnd(_runId, _stepId, _data) { }
    async sendGuardEvent(_runId, _event) { }
    async sendRunEnd(_runId, _status, _totalCost) { }
    isConnected() { return true; }
    disconnect() { }
}
//# sourceMappingURL=noop.js.map