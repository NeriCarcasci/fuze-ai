export * from './types/index.js'

export { canonicalize } from './evidence/canonical.js'
export { redact, redactString } from './evidence/redact.js'
export { HashChain, verifyChain } from './evidence/hash-chain.js'
export type { ChainedRecord, VerifyChainOptions } from './evidence/hash-chain.js'
export { EvidenceEmitter, CURRENT_SPAN_SCHEMA_VERSION } from './evidence/emitter.js'
export type { EvidenceSpan, SpanRole, SpanCommonAttrs, EvidenceEmitterDeps } from './evidence/emitter.js'

export { StaticPolicyEngine } from './policy/static.js'
export type { StaticRule } from './policy/static.js'

export { runAgent } from './loop/loop.js'
export type { LoopDeps, SnapshotSink } from './loop/loop.js'
export { resumeRun, ModelDriftAtResumeError } from './loop/resume.js'
export type { ResumeRunDeps, ResumeRunInput } from './loop/resume.js'
export {
  computeDefinitionFingerprint,
  DefinitionFingerprintMismatchError,
} from './loop/fingerprint.js'

export {
  mintResumeToken,
  verifyResumeToken,
  consumeResumeToken,
  buildSuspendedRun,
  decisionFingerprint,
} from './loop/suspend.js'
export { evaluateApproval } from './loop/approval.js'
export type { EvaluateApprovalDeps, ApprovalOutcome } from './loop/approval.js'
export { executeApprovedTool } from './loop/execute-approved.js'
export type {
  ExecuteApprovedToolDeps,
  ExecuteApprovedToolInput,
  ExecuteApprovedToolOutcome,
} from './loop/execute-approved.js'
export { InMemoryNonceStore } from './loop/in-memory-stores.js'


export type {
  FuzeSandbox,
  SandboxTier,
  SandboxExecInput,
  SandboxExecOutput,
} from './sandbox/types.js'
export { SandboxRefusedError } from './sandbox/types.js'
export { InProcessSandbox, SimpleTenantWatchdog } from './sandbox/in-process.js'
export type { InProcessSandboxOptions, TenantWatchdog } from './sandbox/in-process.js'

export { defineTool } from './agent/define-tool.js'
export { defineAgent } from './agent/define-agent.js'
export type { DefineAgentInput, ResidencyConstraint } from './agent/define-agent.js'
export { inMemorySecrets } from './agent/secrets-noop.js'

// ─── Phase A: planning ──────────────────────────────────────────────────────
export { PlanState, PlanStateError } from './plan/plan-state.js'
export type { PlanStateOptions, PlanStateResult } from './plan/plan-state.js'
export { buildPlanTools, PLAN_TOOL_NAMES, isPlanToolName } from './plan/plan-tools.js'
export type { PlanTools, PlanToolName } from './plan/plan-tools.js'
export type { PlanRequirement, PlanningConfig } from './types/agent.js'
export type {
  PlanStep,
  PlanStepStatus,
  PlanStepLifecycle,
  PlanVersion,
  PlanEvent,
  PlanCommittedEvent,
  PlanStepUpdatedEvent,
  PlanRevisedEvent,
  PlanCommitInput,
  PlanStepUpdateInput,
  PlanReviseInput,
  LinkageSource,
  AutoCaptureContext,
} from './types/plan.js'

// ─── Phase A: ledger schema (types) ─────────────────────────────────────────
export type {
  LedgerEntry,
  LedgerEntryKind,
  LedgerEntryBase,
  ToolCallLedgerEntry,
  ModelCallLedgerEntry,
  HumanInputLedgerEntry,
  DispatchCommittedLedgerEntry,
  DispatchCompletedLedgerEntry,
  OversightSuspendLedgerEntry,
  OversightResumeLedgerEntry,
  ExpectedDeterminism,
} from './types/ledger.js'

// ─── Phase A: replay ────────────────────────────────────────────────────────
export type {
  ReplayMode,
  ReplayResult,
  ReplayInput,
  DeterminismVerdict,
  ToolCallDrift,
  ModelCallDrift,
  PlanDrift,
  OutputDrift,
} from './types/replay.js'

// ─── Phase A: markdown helpers ──────────────────────────────────────────────
export { fromMarkdown, concatenateContext } from './agent/from-markdown.js'
export type { ResolvedMarkdown, ResolvedMarkdownDir } from './agent/from-markdown.js'

// ─── Phase B: capability envelopes & dispatch ───────────────────────────────
export { defineAgentRole } from './agent/define-agent-role.js'
export type {
  AgentRoleDefinition,
  AnyAgentRole,
  DefineAgentRoleInput,
  RetryPolicy,
  OutputViews,
} from './types/role.js'

export {
  synthesizeDispatchTool,
  synthesizeDispatchTools,
  dispatchManifestHash,
} from './agent/dispatch-builder.js'
export type { SynthesizedDispatchTool } from './agent/dispatch-builder.js'

export { buildDispatchTools } from './agent/dispatch-tools.js'
export type {
  DispatchContext,
  RunChildInput,
  RunChildCallback,
  BuildDispatchToolsDeps,
} from './agent/dispatch-tools.js'

export {
  NEVER_RETRY_CATEGORIES,
  isRetriableCategory,
  planStepStatusForFailure,
} from './types/dispatch.js'
export type {
  AgentErrorCategory,
  AgentRunFailure,
  DispatchResult,
  DispatchInputBase,
  FailureAttribution,
} from './types/dispatch.js'

// ─── Phase C: Article 14 oversight v2 ───────────────────────────────────────
export { InMemoryDurableAdapter } from './oversight/durable-adapter.js'
export { requestOversight } from './oversight/request-oversight.js'
export type { RequestOversightDeps, RequestOversightInput } from './oversight/request-oversight.js'
export { resolveOversight } from './oversight/resolve-oversight.js'
export type { ResolveOversightInput } from './oversight/resolve-oversight.js'
export type {
  DurableExecutionAdapter,
  OversightRequest,
  OversightDecision,
  OversightDecisionKind,
  OversightReason,
  ReviewerSignature,
} from './types/oversight-v2.js'
