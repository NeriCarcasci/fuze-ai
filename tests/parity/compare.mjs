#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { normalizeStream } from './normalize.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCENARIOS_DIR = join(__dirname, 'scenarios')

function fail(msg) {
  process.stderr.write(msg + '\n')
  process.exit(1)
}

function runCapture(cmd, args, cwd) {
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
  })
  if (result.status !== 0) {
    const detail = `${cmd} ${args.join(' ')}\nexit=${result.status}\nstderr:\n${result.stderr}\nstdout:\n${result.stdout}`
    fail(`Runner failed:\n${detail}`)
  }
  return result.stdout
}

function diffLines(aText, bText, aLabel, bLabel) {
  const a = aText.split('\n')
  const b = bText.split('\n')
  const max = Math.max(a.length, b.length)
  const out = []
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) {
      out.push(`@@ line ${i + 1} @@`)
      out.push(`- [${aLabel}] ${a[i] ?? ''}`)
      out.push(`+ [${bLabel}] ${b[i] ?? ''}`)
    }
  }
  return out.join('\n')
}

function compareScenario(scenarioDir) {
  const name = scenarioDir.split(/[\\/]/).pop()
  const scenarioPath = join(scenarioDir, 'scenario.json')
  const jsRunner = join(scenarioDir, 'js-runner.mjs')
  const pyRunner = join(scenarioDir, 'python-runner.py')

  if (!existsSync(scenarioPath)) fail(`Missing scenario.json in ${scenarioDir}`)
  if (!existsSync(jsRunner)) fail(`Missing js-runner.mjs in ${scenarioDir}`)
  if (!existsSync(pyRunner)) fail(`Missing python-runner.py in ${scenarioDir}`)

  const jsRaw = runCapture(process.execPath, [jsRunner, scenarioPath], scenarioDir)
  const pyCmd = process.platform === 'win32' ? 'python' : 'python3'
  const pyRaw = runCapture(pyCmd, [pyRunner, scenarioPath], scenarioDir)

  const jsNorm = normalizeStream(jsRaw)
  const pyNorm = normalizeStream(pyRaw)

  if (jsNorm === pyNorm) {
    process.stdout.write(`OK: ${name}\n`)
    return true
  }

  process.stderr.write(`FAIL: ${name}\n`)
  process.stderr.write('--- JS (normalised) ---\n')
  process.stderr.write(jsNorm)
  process.stderr.write('--- Python (normalised) ---\n')
  process.stderr.write(pyNorm)
  process.stderr.write('--- diff ---\n')
  process.stderr.write(diffLines(jsNorm, pyNorm, 'js', 'py') + '\n')
  return false
}

function listScenarios() {
  return readdirSync(SCENARIOS_DIR)
    .map((n) => join(SCENARIOS_DIR, n))
    .filter((p) => statSync(p).isDirectory())
    .sort()
}

const args = process.argv.slice(2)
if (args.length === 0) {
  fail('Usage: compare.mjs <scenario-dir> | --all')
}

let ok = true
if (args[0] === '--all') {
  for (const dir of listScenarios()) {
    if (!compareScenario(dir)) ok = false
  }
} else {
  const dir = resolve(args[0])
  if (!compareScenario(dir)) ok = false
}

process.exit(ok ? 0 : 1)
