export const PATHS = {
  spans: '/v1/spans',
  suspendedRuns: '/v1/suspended-runs',
  suspendedRun: (runId: string) => `/v1/suspended-runs/${encodeURIComponent(runId)}`,
  suspendedRunDecisions: (runId: string) =>
    `/v1/suspended-runs/${encodeURIComponent(runId)}/decisions`,
  runDecisions: (runId: string) => `/v1/runs/${encodeURIComponent(runId)}/decisions`,
  runSpans: (runId: string) => `/v1/runs/${encodeURIComponent(runId)}/spans`,
  runVerify: (runId: string) => `/v1/runs/${encodeURIComponent(runId)}/verify`,
  subjectSpans: (hmac: string) => `/v1/subjects/${encodeURIComponent(hmac)}/spans`,
  health: '/v1/health',
} as const

export const PATH_TEMPLATES = {
  spans: '/v1/spans',
  suspendedRuns: '/v1/suspended-runs',
  suspendedRun: '/v1/suspended-runs/{runId}',
  suspendedRunDecisions: '/v1/suspended-runs/{runId}/decisions',
  runDecisions: '/v1/runs/{runId}/decisions',
  runSpans: '/v1/runs/{runId}/spans',
  runVerify: '/v1/runs/{runId}/verify',
  subjectSpans: '/v1/subjects/{hmac}/spans',
  health: '/v1/health',
} as const

export type PathKey = keyof typeof PATH_TEMPLATES
