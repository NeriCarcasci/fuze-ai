// Stub for Phase 0; real @modelcontextprotocol/sdk wiring deferred to Phase 2.

import type { AnyFuzeTool } from '@fuze-ai/agent'
import type { FuzeMcpHost, McpAdmission } from './types.js'

export interface StubMcpHostDeps {
  readonly resolveTools: (admission: McpAdmission) => Promise<readonly AnyFuzeTool[]>
}

export class StubMcpHost implements FuzeMcpHost {
  private readonly admitted = new Map<string, readonly AnyFuzeTool[]>()
  private disposed = false

  constructor(private readonly deps: StubMcpHostDeps) {}

  async addServer(admission: McpAdmission): Promise<void> {
    if (this.disposed) {
      throw new Error('StubMcpHost: cannot add server after dispose')
    }
    if (this.admitted.has(admission.serverId)) {
      throw new Error(`StubMcpHost: server '${admission.serverId}' already admitted`)
    }
    const candidates = await this.deps.resolveTools(admission)
    const allowed = new Set(admission.allowedToolNames)
    const filtered = candidates.filter((t) => {
      if (!allowed.has(t.name)) return false
      if (t.description.length > admission.maxDescriptionLength) return false
      return true
    })
    this.admitted.set(admission.serverId, filtered)
  }

  listTools(): readonly AnyFuzeTool[] {
    const out: AnyFuzeTool[] = []
    for (const tools of this.admitted.values()) {
      for (const t of tools) out.push(t)
    }
    return out
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.admitted.clear()
  }
}
