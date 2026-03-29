import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import * as TOML from '@iarna/toml'
import type { FuzeConfig, GuardOptions, ResolvedOptions } from './types.js'
import { DEFAULTS } from './types.js'

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
      return TOML.parse(raw) as unknown as FuzeConfig
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

    return {
      maxRetries: guardOptions.maxRetries ?? cfg.maxRetries ?? DEFAULTS.maxRetries,
      timeout: guardOptions.timeout ?? cfg.timeout ?? DEFAULTS.timeout,
      maxCostPerStep: guardOptions.maxCost ?? cfg.maxCostPerStep ?? DEFAULTS.maxCostPerStep,
      maxCostPerRun: cfg.maxCostPerRun ?? DEFAULTS.maxCostPerRun,
      maxIterations: guardOptions.maxIterations ?? cfg.maxIterations ?? DEFAULTS.maxIterations,
      onLoop: guardOptions.onLoop ?? cfg.onLoop ?? DEFAULTS.onLoop,
      traceOutput: cfg.traceOutput ?? DEFAULTS.traceOutput,
      sideEffect: guardOptions.sideEffect ?? DEFAULTS.sideEffect,
      compensate: guardOptions.compensate,
      model: guardOptions.model,
      estimatedTokensIn: guardOptions.estimatedTokensIn,
      estimatedTokensOut: guardOptions.estimatedTokensOut,
      loopDetection: {
        windowSize: loop.windowSize ?? DEFAULTS.loopDetection.windowSize,
        repeatThreshold: loop.repeatThreshold ?? DEFAULTS.loopDetection.repeatThreshold,
        maxFlatSteps: loop.maxFlatSteps ?? DEFAULTS.loopDetection.maxFlatSteps,
        costVelocityWindow: loop.costVelocityWindow ?? DEFAULTS.loopDetection.costVelocityWindow,
        costVelocityThreshold: loop.costVelocityThreshold ?? DEFAULTS.loopDetection.costVelocityThreshold,
      },
    }
  }
}
