/**
 * Tracks which functions have real-world consequences and manages
 * compensation functions for rollback.
 */
export class SideEffectRegistry {
    compensations = new Map();
    sideEffects = [];
    /**
     * Register a compensation function for a tool name.
     * @param toolName - The name of the tool/function.
     * @param compensateFn - The function to call during rollback.
     */
    registerCompensation(toolName, compensateFn) {
        this.compensations.set(toolName, compensateFn);
    }
    /**
     * Record that a side-effect occurred.
     * @param stepId - The unique step identifier.
     * @param toolName - The name of the tool that produced the side-effect.
     * @param result - The result of the tool call.
     */
    recordSideEffect(stepId, toolName, result) {
        this.sideEffects.push({
            stepId,
            toolName,
            result,
            timestamp: new Date().toISOString(),
        });
    }
    /**
     * Execute rollback: call compensation functions in reverse chronological order,
     * starting from the specified step.
     * @param fromStepId - The step ID to start rolling back from (inclusive).
     * @returns An array of compensation results.
     */
    async rollback(fromStepId) {
        const results = [];
        // Find the index of the step to roll back from
        const startIdx = this.sideEffects.findIndex((e) => e.stepId === fromStepId);
        if (startIdx === -1) {
            // If stepId not found, roll back all side-effects
            return this.rollbackAll();
        }
        // Process in reverse order from the specified step
        const toRollback = this.sideEffects.slice(startIdx).reverse();
        for (const entry of toRollback) {
            const compensateFn = this.compensations.get(entry.toolName);
            if (!compensateFn) {
                results.push({
                    stepId: entry.stepId,
                    toolName: entry.toolName,
                    status: 'no_compensation',
                    escalated: true,
                });
                continue;
            }
            try {
                await compensateFn(entry.result);
                results.push({
                    stepId: entry.stepId,
                    toolName: entry.toolName,
                    status: 'compensated',
                    escalated: false,
                });
            }
            catch (err) {
                results.push({
                    stepId: entry.stepId,
                    toolName: entry.toolName,
                    status: 'failed',
                    escalated: true,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }
        return results;
    }
    /**
     * Check if a tool is marked as having side-effects (has a compensation registered).
     * @param toolName - The name of the tool.
     * @returns True if the tool has been registered as a side-effect producer.
     */
    isSideEffect(toolName) {
        return this.compensations.has(toolName);
    }
    /**
     * Returns all recorded side-effects.
     */
    getEffects() {
        return this.sideEffects;
    }
    async rollbackAll() {
        const results = [];
        const reversed = [...this.sideEffects].reverse();
        for (const entry of reversed) {
            const compensateFn = this.compensations.get(entry.toolName);
            if (!compensateFn) {
                results.push({
                    stepId: entry.stepId,
                    toolName: entry.toolName,
                    status: 'no_compensation',
                    escalated: true,
                });
                continue;
            }
            try {
                await compensateFn(entry.result);
                results.push({
                    stepId: entry.stepId,
                    toolName: entry.toolName,
                    status: 'compensated',
                    escalated: false,
                });
            }
            catch (err) {
                results.push({
                    stepId: entry.stepId,
                    toolName: entry.toolName,
                    status: 'failed',
                    escalated: true,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }
        return results;
    }
}
//# sourceMappingURL=side-effect-registry.js.map