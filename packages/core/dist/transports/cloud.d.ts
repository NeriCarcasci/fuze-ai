import type { TelemetryTransport, StepCheckData, StepEndData, GuardEventData } from './types.js';
/**
 * CloudTransport — sends telemetry to api.fuze-ai.tech over HTTPS.
 *
 * Step checks (sendStepStart) are synchronous with a 50ms timeout — the agent
 * never blocks for longer regardless of cloud latency.
 *
 * Everything else is batched in memory and flushed every second (or immediately
 * on sendRunEnd). Events are never lost unless the buffer exceeds 10K entries.
 */
export declare class CloudTransport implements TelemetryTransport {
    private readonly apiKey;
    private readonly endpoint;
    private buffer;
    private flushTimer;
    private _connected;
    constructor(apiKey: string, endpoint?: string);
    connect(): Promise<boolean>;
    sendRunStart(runId: string, agentId: string, config: object): Promise<void>;
    sendStepStart(runId: string, step: StepCheckData): Promise<'proceed' | 'kill' | 'pause'>;
    sendStepEnd(runId: string, stepId: string, data: StepEndData): Promise<void>;
    sendGuardEvent(runId: string, event: GuardEventData): Promise<void>;
    sendRunEnd(runId: string, status: string, totalCost: number): Promise<void>;
    isConnected(): boolean;
    disconnect(): void;
    private _enqueue;
    private _flush;
}
//# sourceMappingURL=cloud.d.ts.map