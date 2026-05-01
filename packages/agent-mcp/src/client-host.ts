import type { AnyFuzeTool } from '@fuze-ai/agent'
import type { FuzeMcpHost, McpAdmission, McpServerFingerprint } from './types.js'
import type {
  McpTransport,
  McpTransportFactory,
  ToolCallObserver,
  ToolCallRecord,
} from './transport.js'
import { RecordingTransport } from './transport.js'
import { AdmissionRefusedError, filterDiscoveredTools, validateAdmission } from './admission.js'

export class FingerprintMismatchError extends Error {
  readonly serverId: string
  readonly expected: McpServerFingerprint
  readonly actual: McpServerFingerprint
  constructor(serverId: string, expected: McpServerFingerprint, actual: McpServerFingerprint) {
    super(
      `MCP server '${serverId}' fingerprint mismatch: expected ${expected.algorithm}:${expected.digest}, got ${actual.algorithm}:${actual.digest}`,
    )
    this.name = 'FingerprintMismatchError'
    this.serverId = serverId
    this.expected = expected
    this.actual = actual
  }
}

export interface FingerprintRecord {
  readonly serverId: string
  readonly fingerprint: McpServerFingerprint
  readonly pinnedAt: number
}

export interface FingerprintStore {
  get(serverId: string): FingerprintRecord | undefined
  put(record: FingerprintRecord): void
  delete(serverId: string): void
}

export class InMemoryFingerprintStore implements FingerprintStore {
  private readonly map = new Map<string, FingerprintRecord>()
  get(serverId: string): FingerprintRecord | undefined {
    return this.map.get(serverId)
  }
  put(record: FingerprintRecord): void {
    this.map.set(record.serverId, record)
  }
  delete(serverId: string): void {
    this.map.delete(serverId)
  }
}

export interface DiscoveredMcpTool {
  readonly name: string
  readonly description: string
}

export interface AdmissionContext {
  readonly admission: McpAdmission
  readonly transport: McpTransport
  readonly discovered: readonly DiscoveredMcpTool[]
}

export interface McpClientHostDeps {
  readonly admissions: ReadonlyArray<McpAdmission>
  readonly transportFactory: McpTransportFactory
  readonly toolBuilder: (ctx: AdmissionContext) => Promise<readonly AnyFuzeTool[]>
  readonly fingerprintStore?: FingerprintStore
  readonly onCall?: ToolCallObserver
}

interface ServerEntry {
  readonly admission: McpAdmission
  readonly transport: McpTransport
  readonly tools: readonly AnyFuzeTool[]
}

const fingerprintsEqual = (a: McpServerFingerprint, b: McpServerFingerprint): boolean =>
  a.algorithm === b.algorithm && a.digest === b.digest

export class McpClientHost implements FuzeMcpHost {
  private readonly servers = new Map<string, ServerEntry>()
  private readonly fingerprintStore: FingerprintStore
  private readonly transportFactory: McpTransportFactory
  private readonly toolBuilder: (ctx: AdmissionContext) => Promise<readonly AnyFuzeTool[]>
  private readonly onCall: ToolCallObserver | undefined
  private disposed = false

  constructor(deps: McpClientHostDeps) {
    this.transportFactory = deps.transportFactory
    this.toolBuilder = deps.toolBuilder
    this.fingerprintStore = deps.fingerprintStore ?? new InMemoryFingerprintStore()
    this.onCall = deps.onCall
  }

  async addServer(admission: McpAdmission): Promise<void> {
    if (this.disposed) {
      throw new Error('McpClientHost: cannot add server after dispose')
    }
    if (this.servers.has(admission.serverId)) {
      throw new Error(`McpClientHost: server '${admission.serverId}' already admitted`)
    }
    validateAdmission(admission)

    const existing = this.fingerprintStore.get(admission.serverId)
    if (existing && !fingerprintsEqual(existing.fingerprint, admission.fingerprint)) {
      throw new FingerprintMismatchError(
        admission.serverId,
        existing.fingerprint,
        admission.fingerprint,
      )
    }

    const inner = await this.transportFactory.create(admission)
    const recorder = this.onCall
      ? new RecordingTransport(inner, admission.serverId, this.onCall)
      : inner

    let discovered: readonly DiscoveredMcpTool[]
    try {
      const raw = await recorder.request('tools/list', {})
      discovered = extractToolList(raw)
    } catch (e) {
      await inner.close()
      throw e
    }

    const filtered = filterDiscoveredTools(admission, discovered)
    const fuzeTools = await this.toolBuilder({
      admission,
      transport: recorder,
      discovered: filtered,
    })

    if (!existing) {
      this.fingerprintStore.put({
        serverId: admission.serverId,
        fingerprint: admission.fingerprint,
        pinnedAt: Date.now(),
      })
    }

    this.servers.set(admission.serverId, {
      admission,
      transport: recorder,
      tools: fuzeTools,
    })
  }

  listTools(): readonly AnyFuzeTool[] {
    const out: AnyFuzeTool[] = []
    for (const entry of this.servers.values()) {
      for (const t of entry.tools) out.push(t)
    }
    return out
  }

  async dispose(): Promise<void> {
    this.disposed = true
    const closes: Array<Promise<void>> = []
    for (const entry of this.servers.values()) {
      closes.push(entry.transport.close())
    }
    await Promise.allSettled(closes)
    this.servers.clear()
  }
}

const extractToolList = (raw: unknown): readonly DiscoveredMcpTool[] => {
  if (!raw || typeof raw !== 'object') return []
  const obj = raw as { tools?: unknown }
  if (!Array.isArray(obj.tools)) return []
  const out: DiscoveredMcpTool[] = []
  for (const item of obj.tools) {
    if (!item || typeof item !== 'object') continue
    const rec = item as { name?: unknown; description?: unknown }
    if (typeof rec.name !== 'string') continue
    const desc = typeof rec.description === 'string' ? rec.description : ''
    out.push({ name: rec.name, description: desc })
  }
  return out
}

export type { ToolCallRecord }
export { AdmissionRefusedError }
