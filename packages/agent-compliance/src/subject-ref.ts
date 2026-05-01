import { createHmac } from 'node:crypto'
import type { SubjectRef } from '@fuze-ai/agent'

export interface DeriveSubjectRefInput {
  readonly identifier: string
  readonly tenantSecret: Buffer | string
}

export const deriveSubjectRef = (input: DeriveSubjectRefInput): SubjectRef => {
  const hmac = createHmac('sha256', input.tenantSecret).update(input.identifier).digest('hex')
  return { hmac, scheme: 'hmac-sha256' }
}
