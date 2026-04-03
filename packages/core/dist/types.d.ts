/**
 * Configuration options passed to guard() for a single wrapped function.
 */
export interface GuardOptions {
    /** Max retry attempts on failure. Default: 3. */
    maxRetries?: number;
    /** Kill after this duration in ms. Default: 30000. */
    timeout?: number;
    /** Hard iteration cap for the run. Default: 25. */
    maxIterations?: number;
    /** If true, Fuze won't auto-retry this function. Default: false. */
    sideEffect?: boolean;
    /** Compensation function called on rollback. */
    compensate?: (...args: unknown[]) => unknown | Promise<unknown>;
    /** What to do on loop detection. Default: 'kill'. */
    onLoop?: 'kill' | 'warn' | 'skip';
    /** Per-call loop detection overrides. */
    loopDetection?: Partial<ResolvedOptions['loopDetection']>;
    /**
     * Custom extractor called on the return value to read actual token usage.
     * Overrides auto-detection for all providers. Return null to skip extraction.
     */
    usageExtractor?: (result: unknown) => {
        tokensIn: number;
        tokensOut: number;
    } | null;
}
/**
 * Global Fuze configuration, typically loaded from fuze.toml.
 */
export interface FuzeConfig {
    defaults?: {
        maxRetries?: number;
        timeout?: number;
        maxIterations?: number;
        onLoop?: 'kill' | 'warn' | 'skip';
        traceOutput?: string;
    };
    loopDetection?: {
        windowSize?: number;
        repeatThreshold?: number;
        maxFlatSteps?: number;
    };
    /**
     * Global usage extractor applied to all guarded functions.
     * Per-guard `usageExtractor` takes precedence when both are set.
     */
    usageExtractor?: (result: unknown) => {
        tokensIn: number;
        tokensOut: number;
    } | null;
    /** Connect to the Fuze daemon for live dashboard. */
    daemon?: {
        enabled?: boolean;
        /** UDS socket path or Windows named pipe. Defaults to platform default. */
        socketPath?: string;
    };
    /**
     * Cloud telemetry — only set this if you are a paid Fuze Cloud customer.
     * Free/self-hosted users leave this unset entirely.
     * Can also be configured via the FUZE_API_KEY environment variable.
     */
    cloud?: {
        /** API key from app.fuze-ai.tech. Format: fz_live_… or fz_test_… */
        apiKey?: string;
        /** Override the default cloud endpoint. Defaults to https://api.fuze-ai.tech */
        endpoint?: string;
        /** Flush cadence for telemetry batches in milliseconds. Minimum 1000ms. */
        flushIntervalMs?: number;
    };
    /** Project settings for tool registration. Can also be set via FUZE_PROJECT_ID env var. */
    project?: {
        projectId?: string;
    };
}
/**
 * Fully resolved options after merging defaults, fuze.toml, and per-function guard options.
 */
export interface ResolvedOptions {
    maxRetries: number;
    timeout: number;
    maxIterations: number;
    onLoop: 'kill' | 'warn' | 'skip';
    traceOutput: string;
    sideEffect: boolean;
    compensate?: (...args: unknown[]) => unknown | Promise<unknown>;
    usageExtractor?: (result: unknown) => {
        tokensIn: number;
        tokensOut: number;
    } | null;
    loopDetection: {
        windowSize: number;
        repeatThreshold: number;
        maxFlatSteps: number;
    };
}
/**
 * Record of a single guarded step execution.
 */
export interface StepRecord {
    stepId: string;
    runId: string;
    stepNumber: number;
    startedAt: string;
    endedAt: string;
    toolName: string;
    argsHash: string;
    hasSideEffect: boolean;
    tokensIn: number;
    tokensOut: number;
    latencyMs: number;
    error?: string;
}
/**
 * Record of a guard event (loop detected, timeout, etc.).
 */
export interface GuardEventRecord {
    eventId: string;
    runId: string;
    stepId?: string;
    timestamp: string;
    type: 'loop_detected' | 'timeout' | 'kill' | 'side_effect_blocked' | 'retry';
    severity: 'warning' | 'action' | 'critical';
    details: Record<string, unknown>;
}
/**
 * Signal emitted by the loop detector when a loop is detected.
 */
export interface LoopSignal {
    type: 'max_iterations' | 'repeated_tool' | 'no_progress';
    details: Record<string, unknown>;
}
/**
 * Result of a compensation attempt during rollback.
 */
export interface CompensationResult {
    stepId: string;
    toolName: string;
    status: 'compensated' | 'no_compensation' | 'failed';
    escalated: boolean;
    error?: string;
    compensationStartedAt?: string;
    compensationEndedAt?: string;
    compensationLatencyMs?: number;
}
/**
 * Side-effect entry stored in the registry.
 */
export interface SideEffectEntry {
    stepId: string;
    toolName: string;
    result: unknown;
    timestamp: string;
}
/**
 * Usage status returned by UsageTracker.getStatus().
 */
export interface UsageStatus {
    totalTokensIn: number;
    totalTokensOut: number;
    stepCount: number;
}
/**
 * Loop detector configuration.
 */
export interface LoopDetectorConfig {
    maxIterations: number;
    windowSize: number;
    repeatThreshold: number;
    maxFlatSteps: number;
}
/**
 * Response from the daemon client.
 */
export interface DaemonResponse {
    action: 'proceed' | 'pause' | 'kill';
    reason?: string;
}
/**
 * A run context that groups multiple guarded steps together.
 */
export interface RunContext {
    runId: string;
    guard: <T extends (...args: unknown[]) => unknown>(fn: T, options?: GuardOptions) => T;
    getStatus: () => UsageStatus;
    end: (status?: string) => Promise<void>;
}
/**
 * Built-in default configuration values.
 */
export declare const DEFAULTS: ResolvedOptions;
//# sourceMappingURL=types.d.ts.map