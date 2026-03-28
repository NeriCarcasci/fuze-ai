import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ConfigLoader } from '../src/config-loader.js'
import { writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const TEST_TOML_PATH = join(process.cwd(), `test-fuze-${Date.now()}.toml`)

describe('ConfigLoader', () => {
  afterEach(() => {
    if (existsSync(TEST_TOML_PATH)) {
      unlinkSync(TEST_TOML_PATH)
    }
  })

  it('returns empty config (built-in defaults apply) when fuze.toml is missing', () => {
    const config = ConfigLoader.load('/nonexistent/path/fuze.toml')

    // Should return empty object, no error
    expect(config).toEqual({})
  })

  it('reads values from fuze.toml', () => {
    writeFileSync(
      TEST_TOML_PATH,
      `
[defaults]
maxRetries = 5
timeout = 60000
maxCostPerRun = 20.0
onLoop = "warn"
`,
      'utf-8',
    )

    const config = ConfigLoader.load(TEST_TOML_PATH)

    expect(config.defaults?.maxRetries).toBe(5)
    expect(config.defaults?.timeout).toBe(60000)
    expect(config.defaults?.maxCostPerRun).toBe(20.0)
    expect(config.defaults?.onLoop).toBe('warn')
  })

  it('fuze.toml values override built-in defaults in merge', () => {
    const projectConfig = {
      defaults: {
        maxRetries: 5,
        timeout: 60000,
      },
    }

    const resolved = ConfigLoader.merge(projectConfig, {})

    expect(resolved.maxRetries).toBe(5)
    expect(resolved.timeout).toBe(60000)
    // Unset values should fall back to defaults
    expect(resolved.maxIterations).toBe(25)
  })

  it('per-function guard options override fuze.toml values', () => {
    const projectConfig = {
      defaults: {
        maxRetries: 5,
        timeout: 60000,
      },
    }

    const resolved = ConfigLoader.merge(projectConfig, {
      maxRetries: 1,
      timeout: 5000,
      maxCost: 0.50,
    })

    expect(resolved.maxRetries).toBe(1)
    expect(resolved.timeout).toBe(5000)
    expect(resolved.maxCostPerStep).toBe(0.50)
  })

  it('throws clear error with file path for invalid TOML', () => {
    writeFileSync(TEST_TOML_PATH, 'this is not valid toml {{{{', 'utf-8')

    expect(() => ConfigLoader.load(TEST_TOML_PATH)).toThrow(TEST_TOML_PATH)
  })

  it('merges loop detection config correctly', () => {
    const projectConfig = {
      loopDetection: {
        windowSize: 10,
        repeatThreshold: 5,
      },
    }

    const resolved = ConfigLoader.merge(projectConfig, {})

    expect(resolved.loopDetection.windowSize).toBe(10)
    expect(resolved.loopDetection.repeatThreshold).toBe(5)
    // Defaults for unset values
    expect(resolved.loopDetection.maxFlatSteps).toBe(4)
  })
})
