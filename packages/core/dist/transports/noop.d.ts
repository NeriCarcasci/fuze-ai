import type { TelemetryTransport, StepCheckData, StepEndData, GuardEventData } from './types.js';
/**
 * No-op transport — used when neither daemon nor cloud is configured.
 * All operations succeed instantly; step checks always return 'proceed'.
 */
export declare class NoopTransport implements TelemetryTransport {
    connect(): Promise<boolean>;
    sendRunStart(_runId: string, _agentId: string, _config: object): Promise<void>;
    sendStepStart(_runId: string, _step: StepCheckData): Promise<'proceed' | 'kill' | 'pause'>;
    sendStepEnd(_runId: string, _stepId: string, _data: StepEndData): Promise<void>;
    sendGuardEvent(_runId: string, _event: GuardEventData): Promise<void>;
    sendRunEnd(_runId: string, _status: string, _totalCost: number): Promise<void>;
    isConnected(): boolean;
    disconnect(): void;
}
//# sourceMappingURL=noop.d.ts.map