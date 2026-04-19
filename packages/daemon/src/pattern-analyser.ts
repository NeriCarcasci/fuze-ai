import type { AgentReliability, PatternAlert } from './types.js'

interface RunOutcome {
  status: string
  failedAtStep?: string
  failedTool?: string
  tokens: number
}

/**
 * Detects cross-run patterns: repeated failures, token spikes, reliability drops.
 * All analysis is in-memory; only aggregates are stored.
 */
export class PatternAnalyser {
  private static readonly MAX_AGENTS = 10_000
  private static readonly EVICT_RATIO = 0.2
  private readonly outcomes = new Map<string, RunOutcome[]>()

  /** Minimum number of runs before emitting pattern alerts. */
  private readonly MIN_RUNS_FOR_ANALYSIS = 5

  /**
   * Record the outcome of a completed run.
   *
   * @param agentId - The agent that ran.
   * @param status - Final status of the run.
   * @param failedAtStep - Step identifier where the failure occurred (optional).
   * @param failedTool - Tool name that failed (optional).
   * @param tokens - Total tokens used by the run (default 0).
   */
  recordRunOutcome(
    agentId: string,
    status: string,
    failedAtStep?: string,
    failedTool?: string,
    tokens = 0,
  ): void {
    const existing = this.outcomes.get(agentId) ?? []
    existing.push({ status, failedAtStep, failedTool, tokens })

    // Touch on write so map order approximates LRU semantics.
    if (this.outcomes.has(agentId)) {
      this.outcomes.delete(agentId)
    }
    this.outcomes.set(agentId, existing)

    this.evictOldAgentsIfNeeded()
  }

  /**
   * Analyse all recorded outcomes and return alerts for patterns that cross thresholds.
   *
   * @returns Array of PatternAlert objects.
   */
  analyse(): PatternAlert[] {
    const alerts: PatternAlert[] = []

    for (const [agentId, runs] of this.outcomes) {
      if (runs.length < this.MIN_RUNS_FOR_ANALYSIS) continue

      const failures = runs.filter(
        (r) => r.status !== 'completed',
      )
      const failureRate = failures.length / runs.length

      // Repeated failure alert: > 60% failure rate
      if (failureRate > 0.6) {
        // Find the failure hotspot tool
        const toolCounts = new Map<string, number>()
        for (const f of failures) {
          if (f.failedTool) {
            toolCounts.set(f.failedTool, (toolCounts.get(f.failedTool) ?? 0) + 1)
          }
        }
        const topTool = [...toolCounts.entries()].sort((a, b) => b[1] - a[1])[0]

        alerts.push({
          type: 'repeated_failure',
          agentId,
          details: {
            failureRate,
            failureCount: failures.length,
            totalRuns: runs.length,
            topFailedTool: topTool?.[0] ?? null,
            topFailedToolCount: topTool?.[1] ?? 0,
          },
          severity: failureRate > 0.8 ? 'critical' : 'warning',
        })
      }

      // Token spike: latest run uses > 2x the mean of previous runs
      if (runs.length >= 2) {
        const prev = runs.slice(0, -1)
        const avgPrev = prev.reduce((s, r) => s + r.tokens, 0) / prev.length
        const latest = runs[runs.length - 1].tokens
        if (avgPrev > 0 && latest > avgPrev * 2) {
          alerts.push({
            type: 'token_spike',
            agentId,
            details: { latestTokens: latest, avgPreviousTokens: avgPrev, spikeRatio: latest / avgPrev },
            severity: 'warning',
          })
        }
      }
    }

    return alerts
  }

  /**
   * Returns reliability statistics for a specific agent.
   *
   * @param agentId - Agent identifier.
   */
  getAgentReliability(agentId: string): AgentReliability {
    const runs = this.outcomes.get(agentId) ?? []
    if (runs.length === 0) {
      return { totalRuns: 0, successRate: 1.0, avgTokensPerRun: 0, failureHotspot: null }
    }

    const successes = runs.filter((r) => r.status === 'completed').length
    const avgTokensPerRun = runs.reduce((s, r) => s + r.tokens, 0) / runs.length

    // Find failure hotspot (tool that failed most)
    const toolCounts = new Map<string, { step: string; count: number }>()
    for (const r of runs) {
      if (r.failedTool) {
        const existing = toolCounts.get(r.failedTool)
        toolCounts.set(r.failedTool, {
          step: r.failedAtStep ?? 'unknown',
          count: (existing?.count ?? 0) + 1,
        })
      }
    }

    let failureHotspot: { step: string; tool: string; count: number } | null = null
    let maxCount = 0
    for (const [tool, { step, count }] of toolCounts) {
      if (count > maxCount) {
        maxCount = count
        failureHotspot = { tool, step, count }
      }
    }

    return {
      totalRuns: runs.length,
      successRate: successes / runs.length,
      avgTokensPerRun,
      failureHotspot,
    }
  }

  private evictOldAgentsIfNeeded(): void {
    if (this.outcomes.size <= PatternAnalyser.MAX_AGENTS) return

    const toEvict = Math.ceil(this.outcomes.size * PatternAnalyser.EVICT_RATIO)
    for (let i = 0; i < toEvict; i++) {
      const oldest = this.outcomes.keys().next()
      if (oldest.done) break
      this.outcomes.delete(oldest.value)
    }
  }
}
