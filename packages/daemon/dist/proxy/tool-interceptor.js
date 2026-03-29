import { createHash, randomUUID } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { ToolConfig } from './tool-config.js';
// ── Inline lightweight budget tracker ─────────────────────────────────────────
class ProxyBudget {
    ceiling;
    spent = 0;
    constructor(ceiling) {
        this.ceiling = ceiling;
    }
    check(estimatedCost, toolName) {
        if (this.spent + estimatedCost > this.ceiling) {
            return (`[fuze] Budget exceeded: tool '${toolName}' estimated $${estimatedCost.toFixed(4)}` +
                ` but run ceiling is $${this.ceiling.toFixed(2)} (spent $${this.spent.toFixed(4)})`);
        }
        return null;
    }
    record(cost) {
        this.spent += cost;
    }
    getSpent() {
        return this.spent;
    }
}
// ── Inline lightweight loop detector ──────────────────────────────────────────
class ProxyLoopDetector {
    maxIterations;
    windowSize;
    repeatThreshold;
    stepCount = 0;
    window = [];
    constructor(maxIterations, windowSize = 20, repeatThreshold = 3) {
        this.maxIterations = maxIterations;
        this.windowSize = windowSize;
        this.repeatThreshold = repeatThreshold;
    }
    onStep() {
        this.stepCount++;
        if (this.stepCount > this.maxIterations) {
            return (`[fuze] Loop detected: max iterations (${this.maxIterations}) exceeded` +
                ` after ${this.stepCount} tool calls`);
        }
        return null;
    }
    onToolCall(signature) {
        this.window.push(signature);
        if (this.window.length > this.windowSize)
            this.window.shift();
        let consecutive = 0;
        for (let i = this.window.length - 1; i >= 0; i--) {
            if (this.window[i] === signature)
                consecutive++;
            else
                break;
        }
        if (consecutive >= this.repeatThreshold) {
            return (`[fuze] Loop detected: tool call repeated ${consecutive} times consecutively`);
        }
        return null;
    }
}
/**
 * Applies Fuze's guard logic to every `tools/call` request.
 *
 * Checks (in order):
 * 1. Max iterations (LoopDetector layer 1)
 * 2. Repeated tool+args (LoopDetector layer 2)
 * 3. Budget ceiling (ProxyBudget)
 *
 * Returns `{ action: "forward" }` to pass the call through, or
 * `{ action: "block" }` with a JSON-RPC error response.
 */
export class ToolInterceptor {
    config;
    tracePath;
    toolConfig;
    budget;
    loopDetector;
    availableTools = [];
    pendingCalls = new Map();
    runId;
    totalCalls = 0;
    blockedCalls = 0;
    callCounts = new Map();
    constructor(config, tracePath) {
        this.config = config;
        this.tracePath = tracePath;
        this.toolConfig = new ToolConfig(config.tools);
        this.budget = new ProxyBudget(config.maxCostPerRun);
        this.loopDetector = new ProxyLoopDetector(config.maxIterations);
        this.runId = `proxy_${Date.now()}_${randomUUID().slice(0, 8)}`;
    }
    /**
     * Cache the available tools from a `tools/list` response.
     */
    setAvailableTools(tools) {
        this.availableTools = tools;
    }
    /**
     * Intercept a `tools/call` message.
     */
    async intercept(message) {
        const { name: toolName, arguments: args } = message.params;
        const argsHash = hashArgs(toolName, args);
        const estimatedCost = this.toolConfig.getToolConfig(toolName).estimatedCost;
        const stepId = randomUUID();
        this.totalCalls++;
        // 1. Max iterations check
        const iterSignal = this.loopDetector.onStep();
        if (iterSignal) {
            this.blockedCalls++;
            void this._appendTrace({
                recordType: 'guard_event',
                eventId: randomUUID(),
                runId: this.runId,
                toolName,
                timestamp: new Date().toISOString(),
                eventType: 'loop_detected',
                details: { reason: iterSignal, argsHash },
            });
            return this._block(message.id, -32000, iterSignal, {
                fuze_event: 'loop_detected',
                tool: toolName,
            });
        }
        // 2. Repeated-call loop detection
        const loopSignal = this.loopDetector.onToolCall(argsHash);
        if (loopSignal) {
            this.blockedCalls++;
            void this._appendTrace({
                recordType: 'guard_event',
                eventId: randomUUID(),
                runId: this.runId,
                toolName,
                timestamp: new Date().toISOString(),
                eventType: 'loop_detected',
                details: { reason: loopSignal, argsHash },
            });
            return this._block(message.id, -32000, loopSignal, {
                fuze_event: 'loop_detected',
                tool: toolName,
            });
        }
        // 3. Per-tool call-count limit
        const callCount = (this.callCounts.get(toolName) ?? 0) + 1;
        const maxCallsPerRun = this.toolConfig.getToolConfig(toolName).maxCallsPerRun;
        this.callCounts.set(toolName, callCount);
        if (callCount > maxCallsPerRun) {
            this.blockedCalls++;
            const msg = `[fuze] Tool '${toolName}' exceeded max calls per run (${maxCallsPerRun})`;
            return this._block(message.id, -32000, msg, {
                fuze_event: 'max_calls_exceeded',
                tool: toolName,
                callCount,
                maxCallsPerRun,
            });
        }
        // 4. Budget check
        const budgetErr = this.budget.check(estimatedCost, toolName);
        if (budgetErr) {
            this.blockedCalls++;
            void this._appendTrace({
                recordType: 'guard_event',
                eventId: randomUUID(),
                runId: this.runId,
                toolName,
                timestamp: new Date().toISOString(),
                eventType: 'budget_exceeded',
                details: { spent: this.budget.getSpent(), ceiling: this.config.maxCostPerRun, estimatedCost },
            });
            return this._block(message.id, -32000, budgetErr, {
                fuze_event: 'budget_exceeded',
                tool: toolName,
                spent: this.budget.getSpent(),
                ceiling: this.config.maxCostPerRun,
            });
        }
        // ✓ Approved — deduct speculatively so concurrent calls can't all sneak under budget
        this.budget.record(estimatedCost);
        // Record pending call for result tracking (trace written at result time)
        this.pendingCalls.set(message.id, {
            toolName,
            argsHash,
            startedAt: Date.now(),
            estimatedCost,
        });
        return { action: 'forward', message, estimatedCost, argsHash };
    }
    /**
     * Record the result of a successful tool call (after response from server).
     */
    recordResult(toolName, callId, result) {
        const pending = this.pendingCalls.get(callId);
        if (!pending)
            return;
        this.pendingCalls.delete(callId);
        const latencyMs = Date.now() - pending.startedAt;
        void this._appendTrace({
            recordType: 'step',
            stepId: randomUUID(),
            runId: this.runId,
            toolName,
            argsHash: pending.argsHash,
            startedAt: new Date(pending.startedAt).toISOString(),
            endedAt: new Date().toISOString(),
            latencyMs,
            estimatedCost: pending.estimatedCost,
            blocked: false,
        });
    }
    /** Returns current run statistics. */
    getStats() {
        return {
            totalCalls: this.totalCalls,
            totalCost: this.budget.getSpent(),
            blockedCalls: this.blockedCalls,
        };
    }
    // ── Private helpers ─────────────────────────────────────────────────────────
    _block(id, code, message, data) {
        return {
            action: 'block',
            response: {
                jsonrpc: '2.0',
                id,
                error: { code, message, data },
            },
        };
    }
    async _appendTrace(record) {
        try {
            await appendFile(this.tracePath, JSON.stringify(record) + '\n', 'utf8');
        }
        catch {
            // Trace write failures are non-fatal
        }
    }
}
// ── Helpers ────────────────────────────────────────────────────────────────────
function hashArgs(toolName, args) {
    return createHash('sha256')
        .update(toolName + JSON.stringify(args))
        .digest('hex')
        .slice(0, 16);
}
//# sourceMappingURL=tool-interceptor.js.map