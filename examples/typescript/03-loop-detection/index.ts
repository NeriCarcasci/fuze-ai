// Fuze AI — Example 03: Loop Detection
//
// When the same function is called with identical arguments more than
// `repeatThreshold` times within a sliding window, Fuze raises LoopDetected.

import { configure, guard, LoopDetected } from 'fuze-ai'

configure({
  defaults: { onLoop: 'kill' },
  loopDetection: { windowSize: 5, repeatThreshold: 3 },
})

async function fetchWeather(city: string): Promise<{
  result: string
  usage: { prompt_tokens: number; completion_tokens: number }
  model: string
}> {
  return {
    result: `${city}: 21C, partly cloudy`,
    usage: { prompt_tokens: 200, completion_tokens: 30 },
    model: 'gpt-4o',
  }
}

const guardedFetch = guard(fetchWeather)

async function main(): Promise<void> {
  console.log('Fuze AI — Loop Detection\n')
  console.log('  windowSize: 5, repeatThreshold: 3, onLoop: kill\n')

  console.log('Different cities — no loop:')
  for (const city of ['Paris', 'London', 'Tokyo']) {
    const r = await guardedFetch(city)
    console.log(`  ${r.result}`)
  }

  console.log('\nSame city repeated — triggers loop:')
  for (let i = 1; i <= 6; i++) {
    try {
      const r = await guardedFetch('Paris')
      console.log(`  retry ${i}: ok — ${r.result}`)
    } catch (err) {
      if (err instanceof LoopDetected) {
        console.log(`  retry ${i}: BLOCKED — ${err.message}`)
        console.log(`    signal: ${err.signal.type}`)
        break
      }
      throw err
    }
  }

  console.log('\nTrace: ./fuze-traces.jsonl')
}

main().catch(console.error)
