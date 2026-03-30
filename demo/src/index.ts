import { configure } from 'fuze-ai'
import { runResearchAgent } from './agent.js'
import { log } from './logger.js'

async function main(): Promise<void> {
  log.header('Fuze AI — End-to-End Demo')
  log.info('Exercises: guard(), budget enforcement, auto cost extraction,')
  log.info('loop detection, side-effect tracking, compensation, trace recording.')
  log.info('')

  // Configure Fuze — connect to daemon for live dashboard
  configure({
    defaults: {
      maxCostPerRun: 2.00,
      maxIterations: 20,
    },
    loopDetection: {
      windowSize: 5,
      repeatThreshold: 3,
      maxFlatSteps: 3,
    },
    daemon: {
      enabled: true,
      // Uses platform default: \\.\pipe\fuze-daemon on Windows
    },
  })

  try {
    await runResearchAgent('AI Agent Safety and EU AI Act Compliance')
  } catch (err: unknown) {
    log.error(`Agent terminated: ${(err as Error).message}`)
    log.warn('This may be expected — budget or loop limit reached.')
  }

  log.header('Demo Summary')
  log.info('Features exercised:')
  log.info('  [x] guard() wrapping via createRun().guard()')
  log.info('  [x] Budget enforcement ($2.00 ceiling)')
  log.info('  [x] Auto cost extraction from LLM usage metadata')
  log.info('  [x] Loop detection (repeated webSearch calls)')
  log.info('  [x] No-progress detection (repeated summarise calls)')
  log.info('  [x] Side-effect tracking (email send)')
  log.info('  [x] Compensation registration (email recall on rollback)')
  log.info('  [x] Trace recording (./fuze-traces.jsonl)')
  log.info('')
  log.info('Run with daemon for full telemetry:')
  log.info('  npx @fuze-ai/daemon & npm start')
}

main().catch((err: unknown) => {
  console.error(`Fatal: ${(err as Error).message}`)
  process.exit(1)
})
