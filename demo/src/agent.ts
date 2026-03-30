import { createRun } from 'fuze-ai'
import { makeDbQuery } from './tools/db-query.js'
import { makeWebSearch } from './tools/web-search.js'
import { makeSummarise } from './tools/summarise.js'
import { makeDraftReport } from './tools/draft-report.js'
import { makeSendEmail, sentEmails } from './tools/send-email.js'
import { log } from './logger.js'

export async function runResearchAgent(topic: string): Promise<void> {
  log.header(`Research Agent: "${topic}"`)
  log.info('Starting research pipeline...')

  // Shared run context — all tools share budget, loop detection, and trace
  const run = createRun('research-agent', { maxCostPerRun: 2.00 })

  const dbQuery = makeDbQuery(run)
  const webSearch = makeWebSearch(run)
  const summarise = makeSummarise(run)
  const draftReport = makeDraftReport(run)
  const sendEmail = makeSendEmail(run)

  // Step 1: Check for previous reports
  log.step(1, 'Checking previous reports')
  const previousReports = await dbQuery('previous_reports')
  log.result(`Found ${(previousReports as unknown[]).length} previous reports`)

  // Step 2: Load stakeholders
  log.step(2, 'Loading stakeholders')
  const stakeholders = await dbQuery('stakeholders') as { name: string; email: string; role: string }[]
  log.result(`Found ${stakeholders.length} stakeholders`)

  // Step 3: Search for regulations
  log.step(3, 'Searching for AI safety regulations')
  const search1 = await webSearch('AI safety regulations')
  log.result(`Found ${search1.results.length} results — auto-extracted cost from usage (${search1.usage.prompt_tokens}+${search1.usage.completion_tokens} tokens)`)

  // Step 4: Search for incidents
  log.step(4, 'Searching for AI agent cost incidents')
  const search2 = await webSearch('AI agent cost incidents')
  log.result(`Found ${search2.results.length} results`)

  // Step 5: Summarise findings
  log.step(5, 'Summarising all findings')
  const allResults = [...search1.results, ...search2.results]
  const summary1 = await summarise(allResults)
  log.result(`Summary: "${summary1.summary.slice(0, 80)}..."`)

  // Step 6: Draft report (expensive LLM call)
  log.step(6, 'Drafting report')
  const report = await draftReport(summary1.summary, topic)
  log.result(`Report: ${report.report.split('\n')[0]}`)

  // Step 7: Send to first stakeholder (SIDE EFFECT — tracked by Fuze)
  log.step(7, 'Sending report to stakeholders')
  const emailResult = await sendEmail(
    stakeholders[0].email,
    `Research Report: ${topic}`,
    report.report,
  )
  log.result(`Sent to ${stakeholders[0].email} (${emailResult.messageId})`)

  // Step 8: Trigger loop detection — repeated identical searches
  log.step(8, 'Agent tries repeated searches (triggers loop detection)...')
  try {
    for (let i = 0; i < 5; i++) {
      await webSearch('AI safety regulations') // same query, same args hash
    }
  } catch (err: unknown) {
    log.guard((err as Error).message)
  }

  // Step 9: Trigger no-progress detection — summarise returns same result each time
  log.step(9, 'Agent tries repeated summarise (triggers no-progress detection)...')
  try {
    for (let i = 0; i < 5; i++) {
      await summarise(allResults)
    }
  } catch (err: unknown) {
    log.guard((err as Error).message)
  }

  const status = run.getStatus()
  await run.end()

  log.header('Agent Complete')
  log.info(`Total cost: $${status.totalCost.toFixed(6)}`)
  log.info(`Total tokens: ${status.totalTokensIn} in, ${status.totalTokensOut} out`)
  log.info(`Total steps: ${status.stepCount}`)
  log.info(`Emails sent: ${sentEmails.length}`)
  log.info('Trace: ./fuze-traces.jsonl')
}
