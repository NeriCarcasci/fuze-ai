import type { FuzeService, ToolRegistration, ToolConfig, StepCheckData, StepEndData, GuardEventData } from './types.js';
interface ApiServiceOptions {
    endpoint?: string;
    flushIntervalMs?: number;
}
/**
 * ApiService talks to api.fuze-ai.tech (or custom endpoint) over HTTPS.
 */
export declare class ApiService implements FuzeService {
    private readonly apiKey;
    private readonly _configCache;
    private readonly _endpoint;
    private readonly _flushIntervalMs;
    private _buffer;
    private _flushTimer;
    private _refreshTimer;
    private _connected;
    private _configRefreshedAt;
    private _consecutiveFailures;
    private _circuitOpenUntil;
    private _probeInFlight;
    private _flushBackoffMs;
    private _nextFlushAt;
    private _beforeExitHandler;
    constructor(apiKey: string, options?: ApiServiceOptions);
    connect(): Promise<boolean>;
    disconnect(): Promise<void>;
    isConnected(): boolean;
    flush(): Promise<void>;
    registerTools(projectId: string, tools: ToolRegistration[]): Promise<void>;
    getToolConfig(toolName: string): ToolConfig | null;
    refreshConfig(force?: boolean): Promise<void>;
    sendRunStart(runId: string, agentId: string, config: object): Promise<void>;
    sendStepStart(runId: string, step: StepCheckData): Promise<'proceed' | 'kill' | 'pause'>;
    sendStepEnd(runId: string, stepId: string, data: StepEndData): Promise<void>;
    sendGuardEvent(runId: string, event: GuardEventData): Promise<void>;
    sendRunEnd(runId: string, status: string): Promise<void>;
    private _enqueue;
    private _flushTick;
    private _flushInternal;
    private _hasApiKey;
    private _isCircuitOpen;
    private _isHalfOpen;
    private _onRequestSuccess;
    private _onRequestFailure;
    private _request;
    private _runInBackground;
}
export {};
//# sourceMappingURL=api-service.d.ts.map