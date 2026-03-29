export type { TelemetryTransport, StepCheckData, StepEndData, GuardEventData } from './types.js'
export { NoopTransport } from './noop.js'
export { SocketTransport, getDefaultSocketPath } from './socket.js'
export { CloudTransport } from './cloud.js'

import type { FuzeConfig } from '../types.js'
import { NoopTransport } from './noop.js'
import { SocketTransport, getDefaultSocketPath } from './socket.js'
import { CloudTransport } from './cloud.js'
import type { TelemetryTransport } from './types.js'

/**
 * Picks and constructs the appropriate transport for the given config.
 *
 * Priority:
 * 1. CloudTransport  — if FUZE_API_KEY env var or config.cloud.apiKey is set
 * 2. SocketTransport — if config.daemon.enabled is true
 * 3. NoopTransport   — otherwise (in-process only, no external telemetry)
 */
export function createTransport(config: FuzeConfig): TelemetryTransport {
  const apiKey = config.cloud?.apiKey ?? process.env['FUZE_API_KEY']
  if (apiKey) {
    return new CloudTransport(apiKey, config.cloud?.endpoint ?? 'https://api.fuze-ai.tech')
  }

  if (config.daemon?.enabled) {
    return new SocketTransport(config.daemon.socketPath ?? getDefaultSocketPath())
  }

  return new NoopTransport()
}
