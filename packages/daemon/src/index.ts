#!/usr/bin/env node
/**
 * @fuze-ai/daemon — CLI entry point.
 *
 * Subcommands:
 *   fuze-ai daemon  [--config <path>]                   Start the runtime daemon
 *   fuze-ai proxy   [options] -- <server-cmd> [args...]  Start the MCP proxy
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

const subcommand = process.argv[2]

if (subcommand === 'proxy') {
  const { runProxy } = await import('./proxy/index.js')
  await runProxy(process.argv.slice(3))
  process.exit(0)
}

// Default: daemon subcommand
import { loadDaemonConfig } from './config.js'
import { AuditStore } from './audit-store.js'
import { BudgetEnforcer } from './budget-enforcer.js'
import { PatternAnalyser } from './pattern-analyser.js'
import { RunManager } from './run-manager.js'
import { AlertManager } from './alert-manager.js'
import { UDSServer } from './uds-server.js'
import { APIServer } from './api-server.js'
import { ConfigCache } from './config-cache.js'
import { ApiSync } from './api-sync.js'

const DEFAULT_CLOUD_ENDPOINT = 'https://api.fuze-ai.tech'

async function main(): Promise<void> {
  // Parse --config flag
  const args = process.argv.slice(2)
  const configIdx = args.indexOf('--config')
  const configPath = configIdx !== -1 ? args[configIdx + 1] : undefined

  const config = loadDaemonConfig(configPath)

  // Ensure storage directory exists
  const storageDir = path.dirname(config.storagePath)
  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true })
  }

  // Build services
  const auditStore = new AuditStore(config.storagePath)
  await auditStore.init()

  // Config cache — always created (cheap, uses same SQLite file as audit store)
  const configCache = new ConfigCache(config.storagePath)
  configCache.init()

  // Cloud API sync — only active when FUZE_API_KEY is set
  let apiSync: ApiSync | null = null
  const apiKey = process.env['FUZE_API_KEY']
  if (apiKey) {
    const projectId = process.env['FUZE_PROJECT_ID'] ?? 'default'
    const endpoint = process.env['FUZE_API_ENDPOINT'] ?? DEFAULT_CLOUD_ENDPOINT
    apiSync = new ApiSync(apiKey, endpoint, configCache, projectId)
    apiSync.start()
    process.stderr.write(`[fuze-daemon] Cloud sync active (project: ${projectId})\n`)
  }

  const budgetEnforcer = new BudgetEnforcer(config.budget)
  const patternAnalyser = new PatternAnalyser()
  const runManager = new RunManager()
  const alertManager = new AlertManager(config.alerts)

  const udsServer = new UDSServer(config.socketPath, {
    runManager,
    budgetEnforcer,
    patternAnalyser,
    auditStore,
    alertManager,
    configCache,
  })

  const apiServer = new APIServer(config.apiPort, {
    runManager,
    budgetEnforcer,
    patternAnalyser,
    auditStore,
    alertManager,
    udsServer,
  })

  // Broadcast SDK run/step lifecycle events to dashboard WebSocket clients
  udsServer.onEvent = (type, data) => {
    apiServer.broadcast({ type, ...data, timestamp: new Date().toISOString() })
  }

  // Forward alerts to WebSocket clients
  const origEmit = alertManager.emit.bind(alertManager)
  alertManager.emit = (input) => {
    origEmit(input)
    apiServer.broadcast({ ...input, timestamp: new Date().toISOString() })
  }

  // Start servers
  await udsServer.start()
  await apiServer.start()

  process.stderr.write(
    `[fuze-daemon] Listening on UDS ${config.socketPath}, HTTP :${config.apiPort}\n`,
  )

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    process.stderr.write(`\n[fuze-daemon] Received ${signal}, shutting down...\n`)
    try {
      apiSync?.stop()
      await udsServer.stop()
      await apiServer.stop()
      await auditStore.close()
      configCache.close()
    } catch (err) {
      process.stderr.write(`[fuze-daemon] Shutdown error: ${(err as Error).message}\n`)
    }
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  // Periodic retention purge (once per hour)
  setInterval(
    () => {
      auditStore.purgeOlderThan(config.retentionDays).then(
        (deleted) => {
          if (deleted > 0) {
            process.stderr.write(`[fuze-daemon] Purged ${deleted} old run(s)\n`)
          }
        },
        (err: unknown) => {
          process.stderr.write(`[fuze-daemon] Purge error: ${(err as Error).message}\n`)
        },
      )
    },
    60 * 60 * 1000,
  ).unref()
}

main().catch((err: unknown) => {
  process.stderr.write(`[fuze-daemon] Fatal: ${(err as Error).message}\n`)
  process.exit(1)
})
