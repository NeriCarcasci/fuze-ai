import { createRun } from 'fuze-ai'
import { fakeLLM } from '../llm-stub.js'

export function makeDraftReport(run: ReturnType<typeof createRun>) {
  return run.guard(
    async function draftReport(summary: unknown, topic: unknown): Promise<{
      report: string
      model: string
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
    }> {
      const llmResponse = await fakeLLM(
        `Write a research report on "${topic}" based on: ${summary}`,
        { tokensIn: 2000, tokensOut: 1500 },
      )

      return {
        report: `# Research Report: ${topic}\n\n## Executive Summary\n${summary}\n\n## Findings\nSee full analysis...\n\n## Recommendations\n1. Implement runtime safety middleware\n2. Adopt EU AI Act compliance measures`,
        model: llmResponse.model,
        usage: llmResponse.usage,
      }
    },
    { model: 'openai/gpt-4o', maxCost: 0.50 },
  )
}
