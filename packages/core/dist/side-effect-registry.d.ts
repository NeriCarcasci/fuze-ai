import type { CompensationResult, SideEffectEntry } from './types.js';
/**
 * Tracks which functions have real-world consequences and manages
 * compensation functions for rollback.
 */
export declare class SideEffectRegistry {
    private compensations;
    private sideEffects;
    private rollbackTail;
    /**
     * Register a compensation function for a tool name.
     * @param toolName - The name of the tool/function.
     * @param compensateFn - The function to call during rollback.
     */
    registerCompensation(toolName: string, compensateFn: (...args: unknown[]) => unknown | Promise<unknown>): void;
    /**
     * Record that a side-effect occurred.
     * @param stepId - The unique step identifier.
     * @param toolName - The name of the tool that produced the side-effect.
     * @param result - The result of the tool call.
     */
    recordSideEffect(stepId: string, toolName: string, result: unknown): void;
    /**
     * Execute rollback: call compensation functions in reverse chronological order,
     * starting from the specified step.
     * @param fromStepId - The step ID to start rolling back from (inclusive).
     * @returns An array of compensation results.
     */
    rollback(fromStepId: string): Promise<CompensationResult[]>;
    /**
     * Check if a tool is marked as having side-effects (has a compensation registered).
     * @param toolName - The name of the tool.
     * @returns True if the tool has been registered as a side-effect producer.
     */
    isSideEffect(toolName: string): boolean;
    /**
     * Returns all recorded side-effects.
     */
    getEffects(): readonly SideEffectEntry[];
    private rollbackAll;
    private rollbackEntries;
    private withRollbackLock;
}
//# sourceMappingURL=side-effect-registry.d.ts.map