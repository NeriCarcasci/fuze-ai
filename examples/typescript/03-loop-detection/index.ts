import { createHash } from 'node:crypto'
import { configure, guard, LoopDetected } from 'fuze-ai'

// Aggressive loop detection:
// - repeatThreshold: 3 (same args 3 times in window -> loop)
// - windowSize: 5 (sliding window of recent calls)
// - onLoop: 'kill' (throw immediately)
configure({
  defaults: {
    maxIterations: 20,
    onLoop: 'kill',
  },
  loopDetection: {
    windowSize: 5,
    repeatThreshold: 3,
  },
})

// Simulates an agent calling a weather API.
// Returns real data (computed hash as "temperature") but always the same
// for the same city -- this is what triggers loop detection.
async function fetchWeather(city: string): Promise<string> {
  const hash = createHash('md5').update(city).digest('hex')
  const temp = (parseInt(hash.slice(0, 2), 16) % 35) + 5
  return `Weather in ${city}: ${temp}C, humidity ${parseInt(hash.slice(2, 4), 16) % 100}%`
}

const protectedFetch = guard(fetchWeather)

async function main() {
  console.log('Fuze AI -- Loop Detection Example\n')
  console.log('Config: windowSize=5, repeatThreshold=3, onLoop=kill')
  console.log('Simulating an agent stuck retrying the same API call...\n')

  // First, show that different args don't trigger detection
  console.log('--- Different cities (no loop) ---')
  for (const city of ['Paris', 'London', 'Tokyo']) {
    const result = await protectedFetch(city)
    console.log(`  ${result}`)
  }
  console.log()

  // Now simulate a stuck agent calling the same city repeatedly
  console.log('--- Same city repeated (triggers loop) ---')
  for (let i = 1; i <= 10; i++) {
    try {
      const result = await protectedFetch('Paris')
      console.log(`  Retry ${i} OK: ${result}`)
    } catch (err) {
      if (err instanceof LoopDetected) {
        console.log(`  Retry ${i} KILLED: ${err.message}`)
        console.log(`    signal: ${err.signal.type}`)
        console.log(`    details:`, JSON.stringify(err.signal.details))
        console.log('\nLoop detection stopped the runaway agent.')
        break
      }
      throw err
    }
  }

  console.log('\nCheck ./fuze-traces.jsonl for the loop trace.')
}

main().catch(console.error)
