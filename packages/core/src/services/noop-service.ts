import type { FuzeService, ToolRegistration, ToolConfig, StepCheckData, StepEndData, GuardEventData } from './types.js'

/**
 * No-op service — used when neither daemon nor cloud is configured.
 * All operations succeed instantly; step checks always return 'proceed';
 * tool config is never fetched (SDK uses local defaults).
 */
export class NoopService implements FuzeService {
  async connect(): Promise<boolean> { return true }
  async disconnect(): Promise<void> {}
  isConnected(): boolean { return true }
  async flush(): Promise<void> {}

  async registerTools(_projectId: string, _tools: ToolRegistration[]): Promise<void> {}
  getToolConfig(_toolName: string): ToolConfig | null { return null }
  async refreshConfig(): Promise<void> {}

  async sendRunStart(_runId: string, _agentId: string, _config: object): Promise<void> {}
  async sendStepStart(_runId: string, _step: StepCheckData): Promise<'proceed' | 'kill' | 'pause'> {
    return 'proceed'
  }
  async sendStepEnd(_runId: string, _stepId: string, _data: StepEndData): Promise<void> {}
  async sendGuardEvent(_runId: string, _event: GuardEventData): Promise<void> {}
  async sendRunEnd(_runId: string, _status: string): Promise<void> {}
}
