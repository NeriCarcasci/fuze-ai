import { createRun } from 'fuze-ai'
import { fakeLLM } from '../llm-stub.js'

let summariseCallCount = 0

export function makeSummarise(run: ReturnType<typeof createRun>) {
  return run.guard(
    async function summarise(texts: unknown): Promise<{
      summary: string
      model: string
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
    }> {
      summariseCallCount++
      const textArr = texts as string[]
      const inputText = textArr.join(' ')

      // After 2nd call, return the same summary to trigger no-progress loop detection
      if (summariseCallCount > 2) {
        return {
          summary: 'AI regulation is evolving rapidly. EU AI Act is the primary framework.',
          model: 'gpt-4o',
          usage: { prompt_tokens: Math.ceil(inputText.length / 4), completion_tokens: 50, total_tokens: Math.ceil(inputText.length / 4) + 50 },
        }
      }

      const llmResponse = await fakeLLM(inputText, {
        tokensIn: Math.ceil(inputText.length / 4),
        tokensOut: 200,
      })

      return {
        summary: `Summary of ${textArr.length} sources: ${textArr.slice(0, 2).join('; ')}. Regulations tightening (call ${summariseCallCount}).`,
        model: llmResponse.model,
        usage: llmResponse.usage,
      }
    },
    { model: 'openai/gpt-4o' },
  )
}
