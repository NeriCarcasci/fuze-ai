import type { AnnexIvMapping } from '../types.js'

export const iso42001Mapping: AnnexIvMapping = {
  id: 'iso-42001',
  title: 'ISO/IEC 42001 — AI Management System Controls (top level)',
  version: '2023',
  sections: [
    {
      id: 'A.4 organizational context',
      title: 'Tenant boundary and accountability',
      attributes: ['fuze.tenant.id', 'fuze.principal.id'],
    },
    {
      id: 'A.5 leadership and policies',
      title: 'Lawful basis, retention policy, oversight plan reference',
      attributes: ['fuze.lawful_basis', 'fuze.retention.policy_id', 'fuze.oversight.plan_id'],
    },
    {
      id: 'A.6 planning — risk and impact assessment',
      title: 'Annex III domain classification and Article 22 flag',
      attributes: ['fuze.annex_iii_domain', 'fuze.art22_decision'],
    },
    {
      id: 'A.7 support — resources and information',
      title: 'Model identification and usage accounting',
      attributes: [
        'gen_ai.system',
        'gen_ai.request.model',
        'gen_ai.usage.input_tokens',
        'gen_ai.usage.output_tokens',
      ],
    },
    {
      id: 'A.8 operation — controls during use',
      title: 'Tool execution, guardrails, sandbox tier',
      attributes: ['fuze.tool.name', 'fuze.guardrail.phase', 'fuze.sandbox.tier', 'fuze.policy.decision'],
    },
    {
      id: 'A.9 performance evaluation — logging',
      title: 'Tamper-evident audit log',
      attributes: ['fuze.evidence.hash', 'fuze.evidence.prev_hash', 'fuze.run.id', 'fuze.step.id'],
    },
    {
      id: 'A.10 improvement — incident handling',
      title: 'Approval/override decisions and incident class',
      attributes: ['fuze.approval.action', 'fuze.incident.class', 'fuze.policy.engine_error'],
    },
  ],
}
