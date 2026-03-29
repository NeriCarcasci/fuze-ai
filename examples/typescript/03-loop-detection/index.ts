import { configure, guard, LoopDetected } from 'fuze-ai'

// Configure aggressive loop detection:
// - maxIterations: 20 (hard cap on total calls)
// - windowSize: 5 (look at the last 5 calls)
// - repeatThreshold: 3 (if the same args appear 3 times in the window, it is a loop)
// - onLoop: 'kill' (throw immediately instead of just warning)
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

// A function that always returns the same thing -- simulating an agent
// stuck in a retry loop calling the same tool with identical arguments.
async function fetchWeather(city: string): Promise<string> {
  await new Promise(r => setTimeout(r, 50))
  return `Weather in ${city}: 22C, sunny`
}

const protectedFetch = guard(fetchWeather)

async function main() {
  console.log('Fuze AI — Loop Detection Example\n')
  console.log('Config: windowSize=5, repeatThreshold=3, onLoop=kill')
  console.log('Calling fetchWeather("Paris") repeatedly...\n')

  for (let i = 1; i <= 10; i++) {
    try {
      const result = await protectedFetch('Paris')
      console.log(`Call ${i} OK:`, result)
    } catch (err) {
      if (err instanceof LoopDetected) {
        console.log(`Call ${i} KILLED: ${err.message}`)
        console.log(`  signal type: ${err.signal.type}`)
        console.log(`  details    :`, err.signal.details)
        console.log('\nLoop detection halted the agent before it could waste more resources.')
        return
      }
      throw err
    }
  }
}

main().catch(console.error)
