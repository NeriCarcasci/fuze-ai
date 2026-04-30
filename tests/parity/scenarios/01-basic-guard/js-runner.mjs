#!/usr/bin/env node
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../../../..')

const { createRun, configure, resetConfig } = await import(
  pathToFileURL(resolve(repoRoot, 'packages/core/dist/index.js')).href
)

const scenarioPath = process.argv[2]
const scenario = JSON.parse(readFileSync(scenarioPath, 'utf-8'))

const workDir = mkdtempSync(join(tmpdir(), 'fuze-parity-js-'))
const tracePath = join(workDir, 'trace.jsonl')

resetConfig()
configure({ defaults: { traceOutput: tracePath } })

const stepDefs = scenario.steps

function makeEcho(tokensIn, tokensOut) {
  return function echo(...args) {
    return {
      content: args.join(' '),
      usage: { prompt_tokens: tokensIn, completion_tokens: tokensOut },
    }
  }
}

const run = createRun(scenario.name, { onLoop: 'warn' })

for (const step of stepDefs) {
  const fn = makeEcho(step.tokensIn, step.tokensOut)
  Object.defineProperty(fn, 'name', { value: step.tool, configurable: true })
  const guarded = run.guard(fn)
  await guarded(...step.args)
}

await run.end('completed')

const lines = readFileSync(tracePath, 'utf-8').split('\n').filter(Boolean)
for (const line of lines) {
  process.stdout.write(line + '\n')
}

rmSync(workDir, { recursive: true, force: true })
