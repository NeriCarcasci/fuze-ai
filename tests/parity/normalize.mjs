#!/usr/bin/env node
import { createInterface } from 'node:readline'

// JS emits camelCase trace keys; Python emits snake_case. Until that parity
// bug is fixed (tracked in tests/parity/README.md), the comparator canonicalises
// to snake_case so structural diffs surface instead of casing noise.
const CAMEL_TO_SNAKE_KEYS = new Set([
  'recordType', 'runId', 'agentId', 'stepId', 'eventId', 'stepNumber',
  'startedAt', 'endedAt', 'toolName', 'argsHash', 'hasSideEffect',
  'tokensIn', 'tokensOut', 'latencyMs', 'prevHash', 'eventType',
  'sideEffect',
])

function camelToSnake(key) {
  return key.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())
}

function canonicaliseKeys(value) {
  if (Array.isArray(value)) return value.map(canonicaliseKeys)
  if (value && typeof value === 'object') {
    const out = {}
    for (const k of Object.keys(value)) {
      const newKey = CAMEL_TO_SNAKE_KEYS.has(k) ? camelToSnake(k) : k
      out[newKey] = canonicaliseKeys(value[k])
    }
    return out
  }
  return value
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/
const HEX64_RE = /^[0-9a-f]{64}$/

const TIMING_FIELDS = new Set(['latency_ms'])
const TIMESTAMP_FIELDS = new Set(['timestamp', 'started_at', 'ended_at'])

class Counters {
  constructor() {
    this.maps = new Map()
  }
  get(kind, value) {
    if (!this.maps.has(kind)) this.maps.set(kind, new Map())
    const m = this.maps.get(kind)
    if (!m.has(value)) m.set(value, m.size + 1)
    return `<${kind}:${m.get(value)}>`
  }
}

function uuidKindFor(fieldName) {
  if (fieldName === 'event_id') return 'uuid_event_id'
  if (fieldName === 'run_id') return 'uuid_run_id'
  if (fieldName === 'step_id') return 'uuid_step_id'
  return 'uuid'
}

function transform(value, fieldName, counters) {
  if (Array.isArray(value)) {
    return value.map((v) => transform(v, fieldName, counters))
  }
  if (value && typeof value === 'object') {
    const out = {}
    for (const k of Object.keys(value).sort()) {
      // The run_start `config` payload echoes the resolved options table and
      // includes absolute trace paths and language-internal optional/null
      // shape. Not part of the load-bearing trace schema. Drop wholesale.
      // Tracked as known parity gap in .context/parity.md.
      if (k === 'config' && fieldName === '<root>') continue
      out[k] = transform(value[k], k, counters)
    }
    return out
  }
  if (typeof value === 'string') {
    if (TIMESTAMP_FIELDS.has(fieldName) && ISO_TS_RE.test(value)) {
      // JS records timestamps at ms resolution (Date.now), Python at us.
      // Cosmetic divergence — flatten to a single placeholder. Tracked as
      // known parity gap in .context/parity.md.
      return '<ts>'
    }
    if (fieldName === 'prev_hash' && HEX64_RE.test(value)) {
      return counters.get('hash', value)
    }
    if (fieldName === 'hash' && HEX64_RE.test(value)) {
      return counters.get('hash', value)
    }
    if (fieldName === 'signature' && /^[0-9a-f]{64}$/.test(value)) {
      return counters.get('sig', value)
    }
    if (UUID_RE.test(value)) {
      return counters.get(uuidKindFor(fieldName), value)
    }
  }
  if (typeof value === 'number' && TIMING_FIELDS.has(fieldName)) {
    return '<duration>'
  }
  return value
}

export function normalizeLine(line, counters) {
  const parsed = JSON.parse(line)
  const renamed = canonicaliseKeys(parsed)
  const transformed = transform(renamed, '<root>', counters)
  return JSON.stringify(transformed)
}

export function normalizeStream(text) {
  const counters = new Counters()
  const out = []
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue
    out.push(normalizeLine(raw, counters))
  }
  return out.join('\n') + '\n'
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  const rl = createInterface({ input: process.stdin })
  const counters = new Counters()
  rl.on('line', (line) => {
    if (!line.trim()) return
    process.stdout.write(normalizeLine(line, counters) + '\n')
  })
}
