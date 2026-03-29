import type { TelemetryTransport, StepCheckData, StepEndData, GuardEventData } from './types.js';
export declare function getDefaultSocketPath(): string;
/**
 * SocketTransport — talks to the user's local Fuze daemon over a Unix Domain Socket
 * (or Windows named pipe). Falls back to 'proceed' within 10ms if the daemon is
 * unavailable so the agent is never blocked by a dead socket.
 */
export declare class SocketTransport implements TelemetryTransport {
    private readonly socketPath;
    private socket;
    private buf;
    private pending;
    private reconnectMs;
    private reconnectTimer;
    private closed;
    private connected;
    constructor(socketPath?: string);
    connect(): Promise<boolean>;
    sendRunStart(runId: string, agentId: string, _config: object): Promise<void>;
    sendStepStart(runId: string, step: StepCheckData): Promise<'proceed' | 'kill' | 'pause'>;
    sendStepEnd(runId: string, stepId: string, data: StepEndData): Promise<void>;
    sendGuardEvent(runId: string, event: GuardEventData): Promise<void>;
    sendRunEnd(runId: string, status: string, totalCost: number): Promise<void>;
    isConnected(): boolean;
    disconnect(): void;
    private _connect;
    private _send;
    private _onMessage;
    private _resolvePendingWithProceed;
    private _scheduleReconnect;
}
//# sourceMappingURL=socket.d.ts.map