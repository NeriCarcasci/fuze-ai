# @fuze-ai/agent-eval

Evaluation framework for `@fuze-ai/agent`. Pydantic-AI-shaped: `Dataset` of `Case` × `Evaluator`.

## Scope

- Run an agent against a dataset; aggregate per-case `EvaluationResult`s.
- Eight built-in evaluators cover the compliance-relevant axes: output equality, schema, latency budget, token budget, evidence-pipeline assertions, policy decision, hash-chain validity, PII leak.
- One opt-in `LlmAsJudgeEvaluator` for free-form scoring.

## Built-in evaluators

- `exactMatchEvaluator` — actual deep-equals expected.
- `schemaShapeEvaluator(schema)` — output passes a zod schema.
- `latencyEvaluator({maxMs})` — sum of span durations.
- `tokenBudgetEvaluator({maxTokens})` — sum of `gen_ai.usage.*`.
- `evidenceContainsEvaluator({spans?, attrs?})` — required spans + attr matchers.
- `policyDecisionEvaluator({expectedEffect, toolName?})` — Cerbos decision matched.
- `hashChainValidEvaluator` — `verifyChain(records)`.
- `noPiiLeakEvaluator` — no `<<fuze:secret:redacted>>` slipped through.

## Determinism

CI must be reproducible. `LlmAsJudgeEvaluator` accepts a `FuzeModel` in its constructor — tests inject a scripted model, no network. No evaluator may consult a clock or external service unless explicitly stubbed.
