import { createHash, randomUUID } from 'node:crypto'
import { appendFile } from 'node:fs/promises'
import type {
  JsonRpcErrorObject,
  McpTool,
  ProxyConfig,
  ToolCallMessage,
  ToolCallResult,
} from './types.js'
import { ToolConfig } from './tool-config.js'

// ── Inline lightweight budget tracker ─────────────────────────────────────────

class ProxyBudget {
  private spent = 0

  constructor(private readonly ceiling: number) {}

  check(estimatedCost: number, toolName: string): string | null {
    if (this.spent + estimatedCost > this.ceiling) {
      return (
        `[fuze] Budget exceeded: tool '${toolName}' estimated $${estimatedCost.toFixed(4)}` +
        ` but run ceiling is $${this.ceiling.toFixed(2)} (spent $${this.spent.toFixed(4)})`
      )
    }
    return null
  }

  record(cost: number): void {
    this.spent += cost
  }

  getSpent(): number {
    return this.spent
  }
}

// ── Inline lightweight loop detector ──────────────────────────────────────────

class ProxyLoopDetector {
  private stepCount = 0
  private readonly window: string[] = []

  constructor(
    private readonly maxIterations: number,
    private readonly windowSize = 20,
    private readonly repeatThreshold = 3,
  ) {}

  onStep(): string | null {
    this.stepCount++
    if (this.stepCount > this.maxIterations) {
      return (
        `[fuze] Loop detected: max iterations (${this.maxIterations}) exceeded` +
        ` after ${this.stepCount} tool calls`
      )
    }
    return null
  }

  onToolCall(signature: string): string | null {
    this.window.push(signature)
    if (this.window.length > this.windowSize) this.window.shift()

    let consecutive = 0
    for (let i = this.window.length - 1; i >= 0; i--) {
      if (this.window[i] === signature) consecutive++
      else break
    }

    if (consecutive >= this.repeatThreshold) {
      return (
        `[fuze] Loop detected: tool call repeated ${consecutive} times consecutively`
      )
    }
    return null
  }
}

// ── Pending call state ─────────────────────────────────────────────────────────

interface PendingCall {
  toolName: string
  argsHash: string
  startedAt: number
  estimatedCost: number
}

// ── Trace record ──────────────────────────────────────────────────────────────

interface TraceStep {
  recordType: 'step'
  stepId: string
  runId: string
  toolName: string
  argsHash: string
  startedAt: string
  endedAt?: string
  latencyMs?: number
  estimatedCost: number
  blocked: boolean
  blockReason?: string
  fuzeEvent?: string
}

interface TraceGuardEvent {
  recordType: 'guard_event'
  eventId: string
  runId: string
  toolName: string
  timestamp: string
  eventType: string
  details: Record<string, unknown>
}

// ── ToolInterceptor ────────────────────────────────────────────────────────────

export interface InterceptResult {
  action: 'forward'
  message: ToolCallMessage
  estimatedCost: number
  argsHash: string
}

export interface BlockResult {
  action: 'block'
  response: {
    jsonrpc: '2.0'
    id: number | string
    error: JsonRpcErrorObject
  }
}

export type InterceptDecision = InterceptResult | BlockResult

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
  private readonly toolConfig: ToolConfig
  private readonly budget: ProxyBudget
  private readonly loopDetector: ProxyLoopDetector
  private availableTools: McpTool[] = []
  private readonly pendingCalls = new Map<number | string, PendingCall>()
  private readonly runId: string

  private totalCalls = 0
  private blockedCalls = 0
  private readonly callCounts = new Map<string, number>()

  constructor(
    private readonly config: ProxyConfig,
    private readonly tracePath: string,
  ) {
    this.toolConfig = new ToolConfig(config.tools)
    this.budget = new ProxyBudget(config.maxCostPerRun)
    this.loopDetector = new ProxyLoopDetector(config.maxIterations)
    this.runId = `proxy_${Date.now()}_${randomUUID().slice(0, 8)}`
  }

  /**
   * Cache the available tools from a `tools/list` response.
   */
  setAvailableTools(tools: McpTool[]): void {
    this.availableTools = tools
  }

  /**
   * Intercept a `tools/call` message.
   */
  async intercept(message: ToolCallMessage): Promise<InterceptDecision> {
    const { name: toolName, arguments: args } = message.params
    const argsHash = hashArgs(toolName, args)
    const estimatedCost = this.toolConfig.getToolConfig(toolName).estimatedCost
    const stepId = randomUUID()

    this.totalCalls++

    // 1. Max iterations check
    const iterSignal = this.loopDetector.onStep()
    if (iterSignal) {
      this.blockedCalls++
      void this._appendTrace({
        recordType: 'guard_event',
        eventId: randomUUID(),
        runId: this.runId,
        toolName,
        timestamp: new Date().toISOString(),
        eventType: 'loop_detected',
        details: { reason: iterSignal, argsHash },
      })
      return this._block(message.id, -32000, iterSignal, {
        fuze_event: 'loop_detected',
        tool: toolName,
      })
    }

    // 2. Repeated-call loop detection
    const loopSignal = this.loopDetector.onToolCall(argsHash)
    if (loopSignal) {
      this.blockedCalls++
      void this._appendTrace({
        recordType: 'guard_event',
        eventId: randomUUID(),
        runId: this.runId,
        toolName,
        timestamp: new Date().toISOString(),
        eventType: 'loop_detected',
        details: { reason: loopSignal, argsHash },
      })
      return this._block(message.id, -32000, loopSignal, {
        fuze_event: 'loop_detected',
        tool: toolName,
      })
    }

    // 3. Per-tool call-count limit
    const callCount = (this.callCounts.get(toolName) ?? 0) + 1
    const maxCallsPerRun = this.toolConfig.getToolConfig(toolName).maxCallsPerRun
    this.callCounts.set(toolName, callCount)
    if (callCount > maxCallsPerRun) {
      this.blockedCalls++
      const msg =
        `[fuze] Tool '${toolName}' exceeded max calls per run (${maxCallsPerRun})`
      return this._block(message.id, -32000, msg, {
        fuze_event: 'max_calls_exceeded',
        tool: toolName,
        callCount,
        maxCallsPerRun,
      })
    }

    // 4. Budget check
    const budgetErr = this.budget.check(estimatedCost, toolName)
    if (budgetErr) {
      this.blockedCalls++
      void this._appendTrace({
        recordType: 'guard_event',
        eventId: randomUUID(),
        runId: this.runId,
        toolName,
        timestamp: new Date().toISOString(),
        eventType: 'budget_exceeded',
        details: { spent: this.budget.getSpent(), ceiling: this.config.maxCostPerRun, estimatedCost },
      })
      return this._block(message.id, -32000, budgetErr, {
        fuze_event: 'budget_exceeded',
        tool: toolName,
        spent: this.budget.getSpent(),
        ceiling: this.config.maxCostPerRun,
      })
    }

    // ✓ Approved — deduct speculatively so concurrent calls can't all sneak under budget
    this.budget.record(estimatedCost)

    // Record pending call for result tracking (trace written at result time)
    this.pendingCalls.set(message.id, {
      toolName,
      argsHash,
      startedAt: Date.now(),
      estimatedCost,
    })

    return { action: 'forward', message, estimatedCost, argsHash }
  }

  /**
   * Record the result of a successful tool call (after response from server).
   */
  recordResult(toolName: string, callId: number | string, result: ToolCallResult): void {
    const pending = this.pendingCalls.get(callId)
    if (!pending) return
    this.pendingCalls.delete(callId)

    const latencyMs = Date.now() - pending.startedAt

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
    })
  }

  /** Returns current run statistics. */
  getStats(): { totalCalls: number; totalCost: number; blockedCalls: number } {
    return {
      totalCalls: this.totalCalls,
      totalCost: this.budget.getSpent(),
      blockedCalls: this.blockedCalls,
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private _block(
    id: number | string,
    code: number,
    message: string,
    data: Record<string, unknown>,
  ): BlockResult {
    return {
      action: 'block',
      response: {
        jsonrpc: '2.0',
        id,
        error: { code, message, data },
      },
    }
  }

  private async _appendTrace(
    record: TraceStep | TraceGuardEvent,
  ): Promise<void> {
    try {
      await appendFile(this.tracePath, JSON.stringify(record) + '\n', 'utf8')
    } catch {
      // Trace write failures are non-fatal
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function hashArgs(toolName: string, args: Record<string, unknown>): string {
  return createHash('sha256')
    .update(toolName + JSON.stringify(args))
    .digest('hex')
    .slice(0, 16)
}
