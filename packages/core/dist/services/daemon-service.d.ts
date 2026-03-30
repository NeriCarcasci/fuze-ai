import type { FuzeService, ToolRegistration, ToolConfig, StepCheckData, StepEndData, GuardEventData } from './types.js';
export declare function getDefaultSocketPath(): string;
/**
 * DaemonService — talks to the user's local Fuze daemon over UDS / named pipe.
 *
 * Config: sends get_config at connect() time and populates in-memory cache.
 * Step checks use a 10ms timeout, falling back to 'proceed'.
 */
export declare class DaemonService implements FuzeService {
    private readonly socketPath;
    private readonly _configCache;
    private _socket;
    private _buf;
    private _pendingStep;
    private _pendingConfig;
    private _reconnectMs;
    private _reconnectTimer;
    private _closed;
    private _connected;
    constructor(socketPath?: string);
    connect(): Promise<boolean>;
    disconnect(): void;
    isConnected(): boolean;
    registerTools(projectId: string, tools: ToolRegistration[]): Promise<void>;
    getToolConfig(toolName: string): ToolConfig | null;
    refreshConfig(): Promise<void>;
    sendRunStart(runId: string, agentId: string, _config: object): Promise<void>;
    sendStepStart(runId: string, step: StepCheckData): Promise<'proceed' | 'kill' | 'pause'>;
    sendStepEnd(runId: string, stepId: string, data: StepEndData): Promise<void>;
    sendGuardEvent(runId: string, event: GuardEventData): Promise<void>;
    sendRunEnd(runId: string, status: string, totalCost: number): Promise<void>;
    private _connect;
    private _send;
    private _onMessage;
    private _resolvePendingStepWithProceed;
    private _scheduleReconnect;
}
//# sourceMappingURL=daemon-service.d.ts.map