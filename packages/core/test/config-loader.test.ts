import { describe, it, expect, afterEach } from 'vitest'
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

    expect(config).toEqual({})
  })

  it('reads canonical snake_case keys from fuze.toml', () => {
    writeFileSync(
      TEST_TOML_PATH,
      `
[defaults]
max_retries = 5
timeout = 60000
on_loop = "warn"
max_iterations = 30
trace_output = "./out.jsonl"

[loop_detection]
window_size = 7
repeat_threshold = 4
max_flat_steps = 6

[resource_limits]
max_steps = 50
max_tokens_per_run = 100000
max_wall_clock_ms = 600000

[daemon]
enabled = true
socket_path = "/tmp/fuze.sock"

[cloud]
api_key = "secret"
endpoint = "https://api.fuze-ai.tech"
flush_interval_ms = 5000

[project]
project_id = "p_abc"
`,
      'utf-8',
    )

    const config = ConfigLoader.load(TEST_TOML_PATH)

    expect(config.defaults?.maxRetries).toBe(5)
    expect(config.defaults?.timeout).toBe(60000)
    expect(config.defaults?.onLoop).toBe('warn')
    expect(config.defaults?.maxIterations).toBe(30)
    expect(config.defaults?.traceOutput).toBe('./out.jsonl')
    expect(config.loopDetection?.windowSize).toBe(7)
    expect(config.loopDetection?.repeatThreshold).toBe(4)
    expect(config.loopDetection?.maxFlatSteps).toBe(6)
    expect(config.resourceLimits?.maxSteps).toBe(50)
    expect(config.resourceLimits?.maxTokensPerRun).toBe(100000)
    expect(config.resourceLimits?.maxWallClockMs).toBe(600000)
    expect(config.daemon?.enabled).toBe(true)
    expect(config.daemon?.socketPath).toBe('/tmp/fuze.sock')
    expect(config.cloud?.apiKey).toBe('secret')
    expect(config.cloud?.endpoint).toBe('https://api.fuze-ai.tech')
    expect(config.cloud?.flushIntervalMs).toBe(5000)
    expect(config.project?.projectId).toBe('p_abc')
  })

  it('accepts deprecated camelCase keys for backwards compatibility', () => {
    writeFileSync(
      TEST_TOML_PATH,
      `
[defaults]
maxRetries = 5
timeout = 60000
onLoop = "warn"

[loopDetection]
windowSize = 10
repeatThreshold = 5

[resourceLimits]
maxTokensPerRun = 99999
`,
      'utf-8',
    )

    const config = ConfigLoader.load(TEST_TOML_PATH)

    expect(config.defaults?.maxRetries).toBe(5)
    expect(config.defaults?.onLoop).toBe('warn')
    expect(config.loopDetection?.windowSize).toBe(10)
    expect(config.loopDetection?.repeatThreshold).toBe(5)
    expect(config.resourceLimits?.maxTokensPerRun).toBe(99999)
  })

  it('snake_case wins when both forms are present in the same table', () => {
    writeFileSync(
      TEST_TOML_PATH,
      `
[defaults]
max_retries = 7
maxRetries = 99
`,
      'utf-8',
    )

    const config = ConfigLoader.load(TEST_TOML_PATH)

    expect(config.defaults?.maxRetries).toBe(7)
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
    })

    expect(resolved.maxRetries).toBe(1)
    expect(resolved.timeout).toBe(5000)
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
    expect(resolved.loopDetection.maxFlatSteps).toBe(4)
  })

  it('throws for malformed numeric values instead of silently ignoring them', () => {
    writeFileSync(
      TEST_TOML_PATH,
      `
[defaults]
timeout = "fast"
`,
      'utf-8',
    )

    expect(() => ConfigLoader.load(TEST_TOML_PATH)).toThrow('defaults.timeout')
  })

  it('throws for invalid on_loop values, referencing canonical snake_case in error', () => {
    writeFileSync(
      TEST_TOML_PATH,
      `
[defaults]
on_loop = "halt"
`,
      'utf-8',
    )

    expect(() => ConfigLoader.load(TEST_TOML_PATH)).toThrow('defaults.on_loop')
  })

  it('error message uses canonical snake_case even when user passed camelCase', () => {
    writeFileSync(
      TEST_TOML_PATH,
      `
[defaults]
onLoop = "halt"
`,
      'utf-8',
    )

    expect(() => ConfigLoader.load(TEST_TOML_PATH)).toThrow('defaults.on_loop')
  })
})
