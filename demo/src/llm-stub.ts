/**
 * Simulates an LLM API call and returns a response with OpenAI-compatible
 * usage metadata so Fuze can auto-extract tokensIn/tokensOut.
 */
export async function fakeLLM(prompt: string, options?: {
  tokensIn?: number
  tokensOut?: number
  model?: string
}): Promise<{
  content: string
  model: string
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}> {
  await new Promise(r => setTimeout(r, 50)) // simulated latency

  const tokensIn = options?.tokensIn ?? Math.ceil(prompt.length / 4)
  const tokensOut = options?.tokensOut ?? 200
  const model = options?.model ?? 'gpt-4o'

  return {
    content: `[LLM response to: "${prompt.slice(0, 60)}..."]`,
    model,
    usage: {
      prompt_tokens: tokensIn,
      completion_tokens: tokensOut,
      total_tokens: tokensIn + tokensOut,
    },
  }
}
