import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import * as TOML from '@iarna/toml'
import type { FuzeConfig, GuardOptions, ResolvedOptions, ResourceLimits } from './types.js'
import { DEFAULTS } from './types.js'

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null
}

// Snake_case is the canonical fuze.toml convention (matches Python SDK and
// TOML idiom). camelCase is accepted as a deprecated alias. If both forms
// are present in the same table, snake_case wins.
function readKey(record: UnknownRecord, snakeName: string, camelName: string): unknown {
  if (record[snakeName] !== undefined) return record[snakeName]
  return record[camelName]
}

function readNumber(
  value: unknown,
  fieldPath: string,
  opts: { integer?: boolean; min?: number; allowInfinity?: boolean } = {},
): number {
  const { integer = false, min = 0, allowInfinity = false } = opts

  if (typeof value !== 'number' || Number.isNaN(value) || (!allowInfinity && !Number.isFinite(value))) {
    throw new Error(`Invalid '${fieldPath}': expected ${allowInfinity ? 'a number or Infinity' : 'a finite number'}`)
  }
  if (integer && !Number.isInteger(value)) {
    throw new Error(`Invalid '${fieldPath}': expected an integer`)
  }
  if (value < min) {
    throw new Error(`Invalid '${fieldPath}': expected a value >= ${min}`)
  }
  return value
}

function readString(value: unknown, fieldPath: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid '${fieldPath}': expected a non-empty string`)
  }
  return value
}

function readOnLoop(value: unknown, fieldPath: string): 'kill' | 'warn' | 'skip' {
  if (value === 'kill' || value === 'warn' || value === 'skip') return value
  throw new Error(`Invalid '${fieldPath}': expected one of 'kill', 'warn', 'skip'`)
}

function parseDefaults(value: unknown): FuzeConfig['defaults'] {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error(`Invalid 'defaults': expected a table/object`)

  const out: NonNullable<FuzeConfig['defaults']> = {}
  const maxRetries = readKey(value, 'max_retries', 'maxRetries')
  if (maxRetries !== undefined) out.maxRetries = readNumber(maxRetries, 'defaults.max_retries', { integer: true, min: 0 })
  if (value['timeout'] !== undefined) out.timeout = readNumber(value['timeout'], 'defaults.timeout', { min: 0, allowInfinity: true })
  const maxIterations = readKey(value, 'max_iterations', 'maxIterations')
  if (maxIterations !== undefined) out.maxIterations = readNumber(maxIterations, 'defaults.max_iterations', { integer: true, min: 1 })
  const onLoop = readKey(value, 'on_loop', 'onLoop')
  if (onLoop !== undefined) out.onLoop = readOnLoop(onLoop, 'defaults.on_loop')
  const traceOutput = readKey(value, 'trace_output', 'traceOutput')
  if (traceOutput !== undefined) out.traceOutput = readString(traceOutput, 'defaults.trace_output')
  return out
}

function parseLoopDetection(value: unknown): FuzeConfig['loopDetection'] {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error(`Invalid 'loop_detection': expected a table/object`)

  const out: NonNullable<FuzeConfig['loopDetection']> = {}
  const windowSize = readKey(value, 'window_size', 'windowSize')
  if (windowSize !== undefined) out.windowSize = readNumber(windowSize, 'loop_detection.window_size', { integer: true, min: 1 })
  const repeatThreshold = readKey(value, 'repeat_threshold', 'repeatThreshold')
  if (repeatThreshold !== undefined) out.repeatThreshold = readNumber(repeatThreshold, 'loop_detection.repeat_threshold', { integer: true, min: 1 })
  const maxFlatSteps = readKey(value, 'max_flat_steps', 'maxFlatSteps')
  if (maxFlatSteps !== undefined) out.maxFlatSteps = readNumber(maxFlatSteps, 'loop_detection.max_flat_steps', { integer: true, min: 1 })
  return out
}

function parseDaemon(value: unknown): FuzeConfig['daemon'] {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error(`Invalid 'daemon': expected a table/object`)

  const daemon: NonNullable<FuzeConfig['daemon']> = {}
  if (value['enabled'] !== undefined) {
    if (typeof value['enabled'] !== 'boolean') {
      throw new Error(`Invalid 'daemon.enabled': expected a boolean`)
    }
    daemon.enabled = value['enabled']
  }
  const socketPath = readKey(value, 'socket_path', 'socketPath')
  if (socketPath !== undefined) daemon.socketPath = readString(socketPath, 'daemon.socket_path')
  return daemon
}

function parseCloud(value: unknown): FuzeConfig['cloud'] {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error(`Invalid 'cloud': expected a table/object`)

  const cloud: NonNullable<FuzeConfig['cloud']> = {}
  const apiKey = readKey(value, 'api_key', 'apiKey')
  if (apiKey !== undefined) cloud.apiKey = readString(apiKey, 'cloud.api_key')
  if (value['endpoint'] !== undefined) cloud.endpoint = readString(value['endpoint'], 'cloud.endpoint')
  const flushIntervalMs = readKey(value, 'flush_interval_ms', 'flushIntervalMs')
  if (flushIntervalMs !== undefined) {
    cloud.flushIntervalMs = readNumber(flushIntervalMs, 'cloud.flush_interval_ms', { integer: true, min: 1000 })
  }
  return cloud
}

function parseResourceLimits(value: unknown): ResourceLimits | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error(`Invalid 'resource_limits': expected a table/object`)

  const out: ResourceLimits = {}
  const maxSteps = readKey(value, 'max_steps', 'maxSteps')
  if (maxSteps !== undefined) {
    out.maxSteps = readNumber(maxSteps, 'resource_limits.max_steps', { integer: true, min: 1 })
  }
  const maxTokensPerRun = readKey(value, 'max_tokens_per_run', 'maxTokensPerRun')
  if (maxTokensPerRun !== undefined) {
    out.maxTokensPerRun = readNumber(maxTokensPerRun, 'resource_limits.max_tokens_per_run', { integer: true, min: 1 })
  }
  const maxWallClockMs = readKey(value, 'max_wall_clock_ms', 'maxWallClockMs')
  if (maxWallClockMs !== undefined) {
    out.maxWallClockMs = readNumber(maxWallClockMs, 'resource_limits.max_wall_clock_ms', { integer: true, min: 1 })
  }
  return out
}

function parseProject(value: unknown): FuzeConfig['project'] {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error(`Invalid 'project': expected a table/object`)

  const project: NonNullable<FuzeConfig['project']> = {}
  const projectId = readKey(value, 'project_id', 'projectId')
  if (projectId !== undefined) project.projectId = readString(projectId, 'project.project_id')
  return project
}

function validateConfig(raw: unknown): FuzeConfig {
  if (!isRecord(raw)) throw new Error('Invalid config root: expected a table/object')

  const usageExtractor = readKey(raw, 'usage_extractor', 'usageExtractor')
  if (usageExtractor !== undefined && typeof usageExtractor !== 'function') {
    throw new Error(`Invalid 'usage_extractor': expected a function`)
  }

  return {
    defaults: parseDefaults(raw['defaults']),
    loopDetection: parseLoopDetection(readKey(raw, 'loop_detection', 'loopDetection')),
    usageExtractor: usageExtractor as FuzeConfig['usageExtractor'],
    daemon: parseDaemon(raw['daemon']),
    cloud: parseCloud(raw['cloud']),
    project: parseProject(raw['project']),
    resourceLimits: parseResourceLimits(readKey(raw, 'resource_limits', 'resourceLimits')),
  }
}

function readResolvedNumber(
  value: number,
  fieldPath: string,
  opts: { integer?: boolean; min?: number; allowInfinity?: boolean } = {},
): number {
  return readNumber(value, fieldPath, opts)
}

export class ConfigLoader {
  static load(path?: string): FuzeConfig {
    const configPath = resolve(path ?? './fuze.toml')

    if (!existsSync(configPath)) {
      return {}
    }

    try {
      const raw = readFileSync(configPath, 'utf-8')
      const parsed = TOML.parse(raw) as unknown
      return validateConfig(parsed)
    } catch (err) {
      throw new Error(
        `Failed to parse Fuze config at '${configPath}': ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  static merge(projectConfig: FuzeConfig, guardOptions: GuardOptions = {}): ResolvedOptions {
    const cfg = projectConfig.defaults ?? {}
    const loop = projectConfig.loopDetection ?? {}

    const resolvedMaxRetries = readResolvedNumber(
      guardOptions.maxRetries ?? cfg.maxRetries ?? DEFAULTS.maxRetries,
      'maxRetries',
      { integer: true, min: 0 },
    )
    const resolvedTimeout = readResolvedNumber(
      guardOptions.timeout ?? cfg.timeout ?? DEFAULTS.timeout,
      'timeout',
      { min: 0, allowInfinity: true },
    )
    const resolvedMaxIterations = readResolvedNumber(
      guardOptions.maxIterations ?? cfg.maxIterations ?? DEFAULTS.maxIterations,
      'maxIterations',
      { integer: true, min: 1 },
    )

    const resolvedOnLoop = readOnLoop(
      guardOptions.onLoop ?? cfg.onLoop ?? DEFAULTS.onLoop,
      'onLoop',
    )

    return {
      maxRetries: resolvedMaxRetries,
      timeout: resolvedTimeout,
      maxIterations: resolvedMaxIterations,
      onLoop: resolvedOnLoop,
      traceOutput: cfg.traceOutput ?? DEFAULTS.traceOutput,
      sideEffect: guardOptions.sideEffect ?? DEFAULTS.sideEffect,
      compensate: guardOptions.compensate,
      usageExtractor: guardOptions.usageExtractor ?? projectConfig.usageExtractor,
      loopDetection: {
        windowSize: readResolvedNumber(
          guardOptions.loopDetection?.windowSize ?? loop.windowSize ?? DEFAULTS.loopDetection.windowSize,
          'loopDetection.windowSize',
          { integer: true, min: 1 },
        ),
        repeatThreshold: readResolvedNumber(
          guardOptions.loopDetection?.repeatThreshold ?? loop.repeatThreshold ?? DEFAULTS.loopDetection.repeatThreshold,
          'loopDetection.repeatThreshold',
          { integer: true, min: 1 },
        ),
        maxFlatSteps: readResolvedNumber(
          guardOptions.loopDetection?.maxFlatSteps ?? loop.maxFlatSteps ?? DEFAULTS.loopDetection.maxFlatSteps,
          'loopDetection.maxFlatSteps',
          { integer: true, min: 1 },
        ),
      },
      resourceLimits: {
        ...(projectConfig.resourceLimits ?? {}),
        ...(guardOptions.resourceLimits ?? {}),
      },
    }
  }
}
