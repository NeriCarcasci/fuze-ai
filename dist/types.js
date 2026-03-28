/**
 * Built-in default configuration values.
 */
export const DEFAULTS = {
    maxRetries: 3,
    timeout: 30000,
    maxCostPerStep: Infinity,
    maxCostPerRun: Infinity,
    maxIterations: 25,
    onLoop: 'kill',
    traceOutput: './fuze-traces.jsonl',
    sideEffect: false,
    loopDetection: {
        windowSize: 5,
        repeatThreshold: 3,
        maxFlatSteps: 4,
        costVelocityWindow: 60,
        costVelocityThreshold: 1.0,
    },
};
//# sourceMappingURL=types.js.map