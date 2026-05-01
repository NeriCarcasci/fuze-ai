import type { AnyFuzeTool } from '@fuze-ai/agent'

export interface BudgetExceededInfo {
  readonly usedTokens: number
  readonly budgetTokens: number
  readonly droppedToolNames: readonly string[]
}

export interface LazyToolRegistryOptions {
  readonly budgetTokens?: number
  readonly softWarnRatio?: number
  readonly onBudgetExceeded?: (info: BudgetExceededInfo) => void
  readonly onSoftWarn?: (info: { usedTokens: number; budgetTokens: number }) => void
}

interface Entry {
  readonly serverId: string
  readonly tool: AnyFuzeTool
  readonly tokens: number
  readonly addedAt: number
}

const DEFAULT_BUDGET = 8000
const DEFAULT_SOFT_RATIO = 0.8

const estimateTokens = (tool: AnyFuzeTool): number => {
  const text = `${tool.name}\n${tool.description}`
  return Math.ceil(text.length / 4)
}

export class LazyToolRegistry {
  private readonly entries: Entry[] = []
  private readonly budgetTokens: number
  private readonly softWarnRatio: number
  private readonly onBudgetExceeded: ((info: BudgetExceededInfo) => void) | undefined
  private readonly onSoftWarn:
    | ((info: { usedTokens: number; budgetTokens: number }) => void)
    | undefined
  private addCounter = 0

  constructor(opts: LazyToolRegistryOptions = {}) {
    this.budgetTokens = opts.budgetTokens ?? DEFAULT_BUDGET
    this.softWarnRatio = opts.softWarnRatio ?? DEFAULT_SOFT_RATIO
    this.onBudgetExceeded = opts.onBudgetExceeded
    this.onSoftWarn = opts.onSoftWarn
  }

  addTools(serverId: string, tools: readonly AnyFuzeTool[]): void {
    for (const tool of tools) {
      this.entries.push({
        serverId,
        tool,
        tokens: estimateTokens(tool),
        addedAt: this.addCounter++,
      })
    }
  }

  size(): number {
    return this.entries.length
  }

  totalTokens(): number {
    let sum = 0
    for (const e of this.entries) sum += e.tokens
    return sum
  }

  // Drops by description length (longest first) until under budget — favors keeping
  // small, dense tools. Ties resolved by latest-added first (LRU on addition order).
  listForTask(_taskHint?: string): readonly AnyFuzeTool[] {
    if (this.entries.length === 0) return []

    const total = this.totalTokens()
    const softThreshold = Math.floor(this.budgetTokens * this.softWarnRatio)
    if (total >= softThreshold && total <= this.budgetTokens && this.onSoftWarn) {
      this.onSoftWarn({ usedTokens: total, budgetTokens: this.budgetTokens })
    }

    if (total <= this.budgetTokens) {
      return this.entries.map((e) => e.tool)
    }

    const ranked = [...this.entries].sort((a, b) => {
      if (b.tokens !== a.tokens) return b.tokens - a.tokens
      return b.addedAt - a.addedAt
    })

    const dropped = new Set<Entry>()
    let used = total
    for (const candidate of ranked) {
      if (used <= this.budgetTokens) break
      dropped.add(candidate)
      used -= candidate.tokens
    }

    const kept = this.entries.filter((e) => !dropped.has(e))
    const droppedNames = [...dropped].map((e) => e.tool.name)

    if (this.onBudgetExceeded) {
      this.onBudgetExceeded({
        usedTokens: total,
        budgetTokens: this.budgetTokens,
        droppedToolNames: droppedNames,
      })
    }

    return kept.map((e) => e.tool)
  }

  clear(): void {
    this.entries.length = 0
  }
}
