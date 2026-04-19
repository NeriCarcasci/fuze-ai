import type { ResourceLimits, ResourceUsageStatus } from './types.js';
export declare class ResourceLimitTracker {
    private totalTokensIn;
    private totalTokensOut;
    private stepCount;
    private readonly startedAt;
    private readonly limits;
    private reservationLock;
    constructor(limits?: ResourceLimits);
    checkAndReserveStep(toolName: string): Promise<void>;
    recordUsage(tokensIn: number, tokensOut: number): void;
    getStatus(): ResourceUsageStatus;
    getLimits(): ResourceLimits;
    private assertWithinLimits;
    private serialize;
}
//# sourceMappingURL=resource-limit-tracker.d.ts.map