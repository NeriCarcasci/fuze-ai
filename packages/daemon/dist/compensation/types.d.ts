/** Types for Phase 5+7 side-effect compensation engine. */
export type CompensationStatus = 'pending' | 'succeeded' | 'failed' | 'no_compensation' | 'skipped';
export interface CompensationRecord {
    compensationId: string;
    runId: string;
    stepId: string;
    toolName: string;
    originalResultJson: string | null;
    compensationStatus: CompensationStatus;
    compensationStartedAt: string | null;
    compensationEndedAt: string | null;
    compensationError: string | null;
    escalated: boolean;
    prevHash: string;
    hash: string;
}
/** Metadata the SDK sends to register a compensable side-effect. */
export interface SerializedCompensation {
    stepId: string;
    toolName: string;
    originalResultJson: string;
}
export interface RollbackResult {
    totalSteps: number;
    compensated: number;
    failed: number;
    noCompensation: number;
    skipped: number;
    details: CompensationRecord[];
}
export interface IdempotencyRecord {
    keyHash: string;
    runId: string;
    stepId: string;
    toolName: string;
    argsHash: string;
    createdAt: string;
    resultJson: string | null;
}
//# sourceMappingURL=types.d.ts.map