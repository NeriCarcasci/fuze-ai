import type { TelemetryTransport, StepCheckData, StepEndData, GuardEventData } from './types.js'

/**
 * No-op transport — used when neither daemon nor cloud is configured.
 * All operations succeed instantly; step checks always return 'proceed'.
 */
export class NoopTransport implements TelemetryTransport {
  async connect(): Promise<boolean> { return true }
  async sendRunStart(_runId: string, _agentId: string, _config: object): Promise<void> {}
  async sendStepStart(_runId: string, _step: StepCheckData): Promise<'proceed' | 'kill' | 'pause'> {
    return 'proceed'
  }
  async sendStepEnd(_runId: string, _stepId: string, _data: StepEndData): Promise<void> {}
  async sendGuardEvent(_runId: string, _event: GuardEventData): Promise<void> {}
  async sendRunEnd(_runId: string, _status: string, _totalCost: number): Promise<void> {}
  isConnected(): boolean { return true }
  disconnect(): void {}
}
