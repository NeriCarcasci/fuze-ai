import type { AnnexIvMapping } from '../types.js'

export const commissionAnnexIvMapping: AnnexIvMapping = {
  id: 'eu-ai-act-annex-iv',
  title: 'EU AI Act Annex IV (Commission draft, August 2024)',
  version: '2024-08-draft',
  sections: [
    {
      id: '§1(a) general description',
      title: 'Intended purpose, version, provider identifiers',
      attributes: ['fuze.tenant.id', 'fuze.principal.id', 'fuze.agent.definition_fingerprint'],
    },
    {
      id: '§1(b) hardware and integration context',
      title: 'How the AI system interacts with hardware/software it is not part of',
      attributes: ['fuze.tool.name', 'fuze.tool.dataClassification', 'fuze.sandbox.tier'],
    },
    {
      id: '§2(a) data sources',
      title: 'Training/validation/test data sources and data governance',
      attributes: ['fuze.data.source', 'fuze.data.classification', 'fuze.tool.residency'],
    },
    {
      id: '§2(b) data governance',
      title: 'Lawful basis, subject reference, residency',
      attributes: ['fuze.lawful_basis', 'fuze.subject.ref', 'fuze.tool.residency'],
    },
    {
      id: '§3(a) technical specifications',
      title: 'Model identification, parameters, system architecture',
      attributes: [
        'gen_ai.system',
        'gen_ai.request.model',
        'gen_ai.response.model',
        'gen_ai.request.temperature',
        'gen_ai.request.max_tokens',
      ],
    },
    {
      id: '§3(b) computational resources',
      title: 'Compute used per inference; usage accounting',
      attributes: [
        'gen_ai.usage.input_tokens',
        'gen_ai.usage.output_tokens',
        'gen_ai.usage.total_tokens',
      ],
    },
    {
      id: '§4(a) automatic logging',
      title: 'Tamper-evident logs of system events',
      attributes: ['fuze.evidence.hash', 'fuze.evidence.prev_hash', 'fuze.evidence.sequence', 'fuze.tenant.id'],
    },
    {
      id: '§4(b) traceability',
      title: 'Run-level traceability and step ordering',
      attributes: ['fuze.run.id', 'fuze.step.id', 'fuze.span.role'],
    },
    {
      id: '§4(c) human oversight',
      title: 'Article 14 human oversight events and decisions',
      attributes: [
        'fuze.oversight.plan_id',
        'fuze.approval.action',
        'fuze.approval.overseer_id',
        'fuze.approval.rationale_hash',
      ],
    },
    {
      id: '§5(a) test reporting',
      title: 'Conformance and pre-deployment test results',
      attributes: ['fuze.conformance.suite', 'fuze.conformance.result', 'fuze.guardrail.phase'],
    },
    {
      id: '§5(b) accuracy and robustness metrics',
      title: 'Measured accuracy, robustness, and consistency',
      attributes: ['fuze.metric.accuracy', 'fuze.metric.robustness', 'fuze.guardrail.outcome'],
    },
    {
      id: '§6(a) risk management',
      title: 'Identified risks and mitigations across the lifecycle',
      attributes: ['fuze.annex_iii_domain', 'fuze.art22_decision', 'fuze.policy.engine_error', 'fuze.policy.decision'],
    },
    {
      id: '§6(b) cybersecurity',
      title: 'Threat boundary, secrets handling, sandbox enforcement',
      attributes: ['fuze.threat.boundary', 'fuze.sandbox.tier', 'fuze.secrets.opaque_ref'],
    },
    {
      id: '§7(a) post-market monitoring',
      title: 'Production usage data feeding the post-market monitoring plan',
      attributes: ['fuze.run.outcome', 'fuze.metric.latency_ms', 'fuze.retention.policy_id'],
    },
    {
      id: '§7(b) serious incident reporting',
      title: 'Incident-class events and operator overrides',
      attributes: ['fuze.incident.class', 'fuze.approval.action', 'fuze.policy.engine_error'],
    },
  ],
}
