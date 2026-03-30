import type { StepCheckData, StepEndData, GuardEventData } from '../transports/types.js';
export type { StepCheckData, StepEndData, GuardEventData };
export interface ToolRegistration {
    name: string;
    description?: string;
    schema?: object;
    sideEffect: boolean;
    defaults: {
        maxRetries: number;
        maxBudget: number;
        timeout: number;
    };
}
export interface ToolConfig {
    maxRetries: number;
    maxBudget: number;
    timeout: number;
    enabled: boolean;
    updatedAt: string;
}
/**
 * Unified service interface — bidirectional replacement for TelemetryTransport.
 *
 * In addition to sending telemetry (same as TelemetryTransport), FuzeService
 * also fetches tool configuration from the API/daemon. This allows the SDK to
 * apply remotely-configured budgets, retries, and timeouts without redeployment.
 *
 * getToolConfig() is intentionally synchronous — it reads from an in-memory
 * cache so the agent's hot path is never blocked by a network call.
 */
export interface FuzeService {
    connect(): Promise<boolean>;
    disconnect(): void;
    isConnected(): boolean;
    /** Register tool metadata with the API/daemon at SDK boot time. Fire-and-forget. */
    registerTools(projectId: string, tools: ToolRegistration[]): Promise<void>;
    /** Synchronous cache read — zero latency on the hot path. Returns null if uncached. */
    getToolConfig(toolName: string): ToolConfig | null;
    /** Async pull of latest tool configs from the remote. Updates internal cache. */
    refreshConfig(): Promise<void>;
    sendRunStart(runId: string, agentId: string, config: object): Promise<void>;
    /**
     * Check whether the step should proceed, be killed, or be paused.
     * Must return within its own internal timeout — never blocks the agent indefinitely.
     */
    sendStepStart(runId: string, step: StepCheckData): Promise<'proceed' | 'kill' | 'pause'>;
    sendStepEnd(runId: string, stepId: string, data: StepEndData): Promise<void>;
    sendGuardEvent(runId: string, event: GuardEventData): Promise<void>;
    sendRunEnd(runId: string, status: string, totalCost: number): Promise<void>;
}
//# sourceMappingURL=types.d.ts.map