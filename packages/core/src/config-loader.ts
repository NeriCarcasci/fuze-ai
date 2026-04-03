import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import * as TOML from '@iarna/toml'
import type { FuzeConfig, GuardOptions, ResolvedOptions } from './types.js'
import { DEFAULTS } from './types.js'

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null
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
  if (value['maxRetries'] !== undefined) out.maxRetries = readNumber(value['maxRetries'], 'defaults.maxRetries', { integer: true, min: 0 })
  if (value['timeout'] !== undefined) out.timeout = readNumber(value['timeout'], 'defaults.timeout', { min: 0, allowInfinity: true })
  if (value['maxIterations'] !== undefined) out.maxIterations = readNumber(value['maxIterations'], 'defaults.maxIterations', { integer: true, min: 1 })
  if (value['onLoop'] !== undefined) out.onLoop = readOnLoop(value['onLoop'], 'defaults.onLoop')
  if (value['traceOutput'] !== undefined) out.traceOutput = readString(value['traceOutput'], 'defaults.traceOutput')
  return out
}

function parseLoopDetection(value: unknown): FuzeConfig['loopDetection'] {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error(`Invalid 'loopDetection': expected a table/object`)

  const out: NonNullable<FuzeConfig['loopDetection']> = {}
  if (value['windowSize'] !== undefined) out.windowSize = readNumber(value['windowSize'], 'loopDetection.windowSize', { integer: true, min: 1 })
  if (value['repeatThreshold'] !== undefined) out.repeatThreshold = readNumber(value['repeatThreshold'], 'loopDetection.repeatThreshold', { integer: true, min: 1 })
  if (value['maxFlatSteps'] !== undefined) out.maxFlatSteps = readNumber(value['maxFlatSteps'], 'loopDetection.maxFlatSteps', { integer: true, min: 1 })
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
  if (value['socketPath'] !== undefined) daemon.socketPath = readString(value['socketPath'], 'daemon.socketPath')
  return daemon
}

function parseCloud(value: unknown): FuzeConfig['cloud'] {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error(`Invalid 'cloud': expected a table/object`)

  const cloud: NonNullable<FuzeConfig['cloud']> = {}
  if (value['apiKey'] !== undefined) cloud.apiKey = readString(value['apiKey'], 'cloud.apiKey')
  if (value['endpoint'] !== undefined) cloud.endpoint = readString(value['endpoint'], 'cloud.endpoint')
  if (value['flushIntervalMs'] !== undefined) {
    cloud.flushIntervalMs = readNumber(value['flushIntervalMs'], 'cloud.flushIntervalMs', { integer: true, min: 1000 })
  }
  return cloud
}

function parseProject(value: unknown): FuzeConfig['project'] {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error(`Invalid 'project': expected a table/object`)

  const project: NonNullable<FuzeConfig['project']> = {}
  if (value['projectId'] !== undefined) project.projectId = readString(value['projectId'], 'project.projectId')
  return project
}

function validateConfig(raw: unknown): FuzeConfig {
  if (!isRecord(raw)) throw new Error('Invalid config root: expected a table/object')

  const usageExtractor = raw['usageExtractor']
  if (usageExtractor !== undefined && typeof usageExtractor !== 'function') {
    throw new Error(`Invalid 'usageExtractor': expected a function`)
  }

  return {
    defaults: parseDefaults(raw['defaults']),
    loopDetection: parseLoopDetection(raw['loopDetection']),
    usageExtractor: usageExtractor as FuzeConfig['usageExtractor'],
    daemon: parseDaemon(raw['daemon']),
    cloud: parseCloud(raw['cloud']),
    project: parseProject(raw['project']),
  }
}

function readResolvedNumber(
  value: number,
  fieldPath: string,
  opts: { integer?: boolean; min?: number; allowInfinity?: boolean } = {},
): number {
  return readNumber(value, fieldPath, opts)
}

/**
 * Loads Fuze configuration from fuze.toml and merges with defaults and per-function options.
 */
export class ConfigLoader {
  /**
   * Load configuration from a fuze.toml file.
   * Returns built-in defaults if the file does not exist.
   * @param path - Path to fuze.toml. Defaults to './fuze.toml' in the current working directory.
   * @returns The parsed Fuze configuration.
   * @throws Error with file path if the TOML is invalid.
   */
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

  /**
   * Merge project config (from fuze.toml) with per-function guard options.
   * Priority: guardOptions > projectConfig > DEFAULTS.
   * @param projectConfig - Configuration loaded from fuze.toml.
   * @param guardOptions - Per-function options passed to guard().
   * @returns Fully resolved options.
   */
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
    }
  }
}
