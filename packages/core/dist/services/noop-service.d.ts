import type { FuzeService, ToolRegistration, ToolConfig, StepCheckData, StepEndData, GuardEventData } from './types.js';
/**
 * No-op service — used when neither daemon nor cloud is configured.
 * All operations succeed instantly; step checks always return 'proceed';
 * tool config is never fetched (SDK uses local defaults).
 */
export declare class NoopService implements FuzeService {
    connect(): Promise<boolean>;
    disconnect(): Promise<void>;
    isConnected(): boolean;
    flush(): Promise<void>;
    registerTools(_projectId: string, _tools: ToolRegistration[]): Promise<void>;
    getToolConfig(_toolName: string): ToolConfig | null;
    refreshConfig(): Promise<void>;
    sendRunStart(_runId: string, _agentId: string, _config: object): Promise<void>;
    sendStepStart(_runId: string, _step: StepCheckData): Promise<'proceed' | 'kill' | 'pause'>;
    sendStepEnd(_runId: string, _stepId: string, _data: StepEndData): Promise<void>;
    sendGuardEvent(_runId: string, _event: GuardEventData): Promise<void>;
    sendRunEnd(_runId: string, _status: string): Promise<void>;
}
//# sourceMappingURL=noop-service.d.ts.map