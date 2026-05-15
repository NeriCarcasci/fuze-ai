#!/usr/bin/env node
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../../../..')

const { run, span, traced, configure, resetConfig } = await import(
  pathToFileURL(resolve(repoRoot, 'packages/core/dist/index.js')).href
)

const scenarioPath = process.argv[2]
const scenario = JSON.parse(readFileSync(scenarioPath, 'utf-8'))

const workDir = mkdtempSync(join(tmpdir(), 'fuze-parity-js-'))
const tracePath = join(workDir, 'trace.jsonl')

resetConfig()
configure({ defaults: { traceOutput: tracePath } })

await run({ agentId: scenario.name }, async () => {
  for (const entry of scenario.spans) {
    if (entry.kind === 'span') {
      await span({
        role: entry.role,
        capture: entry.capture ?? 'hash',
        content: entry.content,
        attrs: entry.attrs,
        toolName: entry.tool_name,
      })
    } else if (entry.kind === 'traced') {
      const fn = (...args) => ({ called: entry.tool_name, args })
      Object.defineProperty(fn, 'name', { value: entry.tool_name, configurable: true })
      const wrapped = traced(fn, {
        role: entry.role,
        capture: entry.capture ?? 'hash',
        toolName: entry.tool_name,
      })
      await wrapped(...(entry.args ?? []))
    }
  }
})

const lines = readFileSync(tracePath, 'utf-8').split('\n').filter(Boolean)
for (const line of lines) {
  process.stdout.write(line + '\n')
}

rmSync(workDir, { recursive: true, force: true })
