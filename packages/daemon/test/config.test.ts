import { describe, it, expect } from 'vitest'
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { loadDaemonConfig } from '../src/config.js'

describe('loadDaemonConfig', () => {
  it('returns defaults when no config file exists', () => {
    const config = loadDaemonConfig('/nonexistent/path/fuze.toml')
    expect(config.apiPort).toBe(7821)
    expect(config.retentionDays).toBe(90)
    expect(config.budget.orgDailyBudget).toBe(100)
    expect(config.budget.alertThreshold).toBe(0.8)
  })

  it('overrides defaults from a TOML config file', () => {
    const tmpFile = path.join(os.tmpdir(), `fuze-cfg-${Date.now()}.toml`)
    fs.writeFileSync(tmpFile, `
[daemon]
api_port = 9000
retention_days = 30

[daemon.budget]
org_daily_budget = 50
per_agent_daily_budget = 10
alert_threshold = 0.9
`)
    try {
      const config = loadDaemonConfig(tmpFile)
      expect(config.apiPort).toBe(9000)
      expect(config.retentionDays).toBe(30)
      expect(config.budget.orgDailyBudget).toBe(50)
      expect(config.budget.perAgentDailyBudget).toBe(10)
      expect(config.budget.alertThreshold).toBeCloseTo(0.9)
    } finally {
      fs.unlinkSync(tmpFile)
    }
  })

  it('returns defaults when config file is unreadable', () => {
    const config = loadDaemonConfig('/root/no-permission/fuze.toml')
    expect(config.apiPort).toBe(7821)
  })

  it('uses correct default socketPath for the platform', () => {
    const config = loadDaemonConfig('/nonexistent.toml')
    expect(config.socketPath).toContain('fuze-daemon')
  })

  it('uses correct default storagePath in home directory', () => {
    const config = loadDaemonConfig('/nonexistent.toml')
    expect(config.storagePath).toContain('audit.db')
  })

  it('defaults alerts dedupWindowMs to 60000', () => {
    const config = loadDaemonConfig('/nonexistent.toml')
    expect(config.alerts.dedupWindowMs).toBe(60_000)
  })
})
