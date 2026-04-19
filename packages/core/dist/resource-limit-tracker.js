import { ResourceLimitExceeded } from './errors.js';
export class ResourceLimitTracker {
    totalTokensIn = 0;
    totalTokensOut = 0;
    stepCount = 0;
    startedAt = Date.now();
    limits;
    reservationLock = Promise.resolve();
    constructor(limits = {}) {
        this.limits = limits;
    }
    async checkAndReserveStep(toolName) {
        await this.serialize(() => {
            this.assertWithinLimits(toolName);
            this.stepCount++;
        });
    }
    recordUsage(tokensIn, tokensOut) {
        if (Number.isFinite(tokensIn) && tokensIn >= 0) {
            this.totalTokensIn += tokensIn;
        }
        if (Number.isFinite(tokensOut) && tokensOut >= 0) {
            this.totalTokensOut += tokensOut;
        }
    }
    getStatus() {
        return {
            totalTokensIn: this.totalTokensIn,
            totalTokensOut: this.totalTokensOut,
            stepCount: this.stepCount,
            wallClockMs: Date.now() - this.startedAt,
        };
    }
    getLimits() {
        return { ...this.limits };
    }
    assertWithinLimits(toolName) {
        const { maxSteps, maxTokensPerRun, maxWallClockMs } = this.limits;
        if (typeof maxSteps === 'number' && this.stepCount + 1 > maxSteps) {
            throw new ResourceLimitExceeded({
                toolName,
                limit: 'maxSteps',
                ceiling: maxSteps,
                observed: this.stepCount + 1,
            });
        }
        const totalTokens = this.totalTokensIn + this.totalTokensOut;
        if (typeof maxTokensPerRun === 'number' && totalTokens > maxTokensPerRun) {
            throw new ResourceLimitExceeded({
                toolName,
                limit: 'maxTokensPerRun',
                ceiling: maxTokensPerRun,
                observed: totalTokens,
            });
        }
        if (typeof maxWallClockMs === 'number') {
            const elapsed = Date.now() - this.startedAt;
            if (elapsed > maxWallClockMs) {
                throw new ResourceLimitExceeded({
                    toolName,
                    limit: 'maxWallClockMs',
                    ceiling: maxWallClockMs,
                    observed: elapsed,
                });
            }
        }
    }
    async serialize(fn) {
        const previous = this.reservationLock;
        let release;
        this.reservationLock = new Promise((resolve) => { release = resolve; });
        await previous;
        try {
            return await fn();
        }
        finally {
            release();
        }
    }
}
//# sourceMappingURL=resource-limit-tracker.js.map