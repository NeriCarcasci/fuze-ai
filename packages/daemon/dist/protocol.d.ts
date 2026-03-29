/** JSON-over-newline protocol for SDK ↔ Daemon communication. */
export interface RunStartMessage {
    type: 'run_start';
    runId: string;
    agentId: string;
    agentVersion?: string;
    modelProvider?: string;
    modelName?: string;
    config?: Record<string, unknown>;
}
export interface RunEndMessage {
    type: 'run_end';
    runId: string;
    status: 'completed' | 'failed' | 'killed' | 'budget_exceeded' | 'loop_detected';
    totalCost: number;
}
export interface StepStartMessage {
    type: 'step_start';
    runId: string;
    stepId: string;
    stepNumber: number;
    toolName: string;
    argsHash: string;
    sideEffect: boolean;
}
export interface StepEndMessage {
    type: 'step_end';
    runId: string;
    stepId: string;
    costUsd: number;
    tokensIn: number;
    tokensOut: number;
    latencyMs: number;
    error?: string | null;
}
export interface GuardEventMessage {
    type: 'guard_event';
    runId: string;
    stepId?: string;
    eventType: 'loop_detected' | 'budget_exceeded' | 'timeout' | 'side_effect_blocked';
    severity: 'warning' | 'action' | 'critical';
    details: Record<string, unknown>;
}
export type SDKMessage = RunStartMessage | RunEndMessage | StepStartMessage | StepEndMessage | GuardEventMessage;
export interface ProceedResponse {
    type: 'proceed';
}
export interface KillResponse {
    type: 'kill';
    reason: string;
    message: string;
}
export interface PauseResponse {
    type: 'pause';
    reason: string;
    approvalId: string;
}
export interface RetryResponse {
    type: 'retry';
    context: string;
}
export type DaemonResponse = ProceedResponse | KillResponse | PauseResponse | RetryResponse;
/**
 * Parse a raw JSON string into a typed SDKMessage.
 *
 * @param raw - A single line of JSON (without trailing newline).
 * @throws Error if the JSON is invalid or required fields are missing.
 */
export declare function parseMessage(raw: string): SDKMessage;
/**
 * Serialise a DaemonResponse to a single-line JSON string with trailing newline.
 *
 * @param response - The response to serialise.
 * @returns JSON string terminated with '\n'.
 */
export declare function serialiseResponse(response: DaemonResponse): string;
/** Convenience factory for a proceed response. */
export declare const PROCEED: ProceedResponse;
//# sourceMappingURL=protocol.d.ts.map