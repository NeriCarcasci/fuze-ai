#!/usr/bin/env node
/**
 * @fuze-ai/daemon - CLI entry point.
 *
 * Subcommands:
 *   fuze-ai daemon  [--config <path>]                     Start the runtime daemon
 *   fuze-ai proxy   [options] -- <server-cmd> [args...]  Start the MCP proxy
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
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
import { CompensationEngine } from './compensation/compensation-engine.js'
import { IdempotencyManager } from './compensation/idempotency.js'

const DEFAULT_CLOUD_ENDPOINT = 'https://api.fuze-ai.tech'

function isExecutedDirectly(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  return import.meta.url === pathToFileURL(entry).href
}

async function runProxyCommand(args: string[]): Promise<void> {
  const { runProxy } = await import('./proxy/index.js')
  await runProxy(args)
}

export async function startDaemon(args: string[]): Promise<void> {
  // Parse --config flag
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
  try {
    await auditStore.init()
  } catch (err) {
    process.stderr.write(`[fuze-daemon] Failed to initialize audit store: ${(err as Error).message}\n`)
    process.exit(1)
    return
  }

  // Config cache - always created (cheap, uses same SQLite file as audit store)
  const configCache = new ConfigCache(config.storagePath)
  configCache.init()

  // Cloud API sync - only active when FUZE_API_KEY is set
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
  const compensationEngine = new CompensationEngine(auditStore, alertManager)
  const idempotencyManager = new IdempotencyManager(auditStore)

  const udsServer = new UDSServer(config.socketPath, {
    runManager,
    budgetEnforcer,
    patternAnalyser,
    auditStore,
    alertManager,
    configCache,
    idempotencyManager,
  })

  const apiServer = new APIServer(config.apiPort, {
    runManager,
    budgetEnforcer,
    patternAnalyser,
    auditStore,
    alertManager,
    udsServer,
    compensationEngine,
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

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const subcommand = argv[0]
  if (subcommand === 'proxy') {
    await runProxyCommand(argv.slice(1))
    process.exit(0)
    return
  }

  const daemonArgs = subcommand === 'daemon' ? argv.slice(1) : argv
  await startDaemon(daemonArgs)
}

if (isExecutedDirectly()) {
  runCli().catch((err: unknown) => {
    process.stderr.write(`[fuze-daemon] Fatal: ${(err as Error).message}\n`)
    process.exit(1)
  })
}