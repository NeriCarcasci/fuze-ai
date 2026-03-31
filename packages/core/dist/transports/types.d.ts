/**
 * Data for a pre-execution step check sent to the transport.
 */
export interface StepCheckData {
    stepId: string;
    stepNumber: number;
    toolName: string;
    argsHash: string;
    sideEffect: boolean;
}
/**
 * Metadata sent after a step completes.
 */
export interface StepEndData {
    toolName: string;
    stepNumber: number;
    argsHash: string;
    hasSideEffect: boolean;
    costUsd: number;
    tokensIn: number;
    tokensOut: number;
    latencyMs: number;
    error?: string | null;
}
/**
 * A guard event (loop detected, budget exceeded, etc.).
 */
export interface GuardEventData {
    stepId?: string;
    eventType: string;
    severity: string;
    details: Record<string, unknown>;
}
/**
 * Unified transport interface — every transport (socket, cloud, noop) implements this.
 *
 * Calls to sendStepStart() are synchronous from the guard's perspective:
 * the transport must respond within its timeout or return 'proceed'.
 * Everything else is fire-and-forget (async but not awaited for decisions).
 */
export interface TelemetryTransport {
    /** Establish connection. Returns false if unavailable; never throws. */
    connect(): Promise<boolean>;
    /** Notify that a run has started. */
    sendRunStart(runId: string, agentId: string, config: object): Promise<void>;
    /**
     * Check whether the step should proceed, be killed, or be paused.
     * Must return within its own internal timeout — never block the agent indefinitely.
     */
    sendStepStart(runId: string, step: StepCheckData): Promise<'proceed' | 'kill' | 'pause'>;
    /** Notify that a step has ended. */
    sendStepEnd(runId: string, stepId: string, data: StepEndData): Promise<void>;
    /** Notify of a guard event (loop, budget, etc.). */
    sendGuardEvent(runId: string, event: GuardEventData): Promise<void>;
    /** Notify that a run has ended; implementations should flush any buffered events. */
    sendRunEnd(runId: string, status: string, totalCost: number): Promise<void>;
    /** Whether the transport is currently connected / healthy. */
    isConnected(): boolean;
    /** Tear down the connection and cancel timers. */
    disconnect(): void;
}
//# sourceMappingURL=types.d.ts.map