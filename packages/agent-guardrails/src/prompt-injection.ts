import type { FuzeGuardrail, GuardrailResult } from '@fuze-ai/agent'

export interface PromptInjectionGuardrailOptions {
  readonly name?: string
  readonly minBase64Length?: number
}

interface PatternRule {
  readonly id: string
  readonly re: RegExp
  readonly weight: number
}

const PATTERNS: readonly PatternRule[] = [
  { id: 'ignore-instructions', re: /ignore\s+(all|previous|prior|above)\s+(instructions|rules|prompts|directives)/i, weight: 1 },
  { id: 'role-override', re: /\b(you\s+are\s+now|act\s+as|pretend\s+to\s+be)\s+(?:a|an|now)\b/i, weight: 1 },
  { id: 'im-start', re: /<\|im_start\|>/i, weight: 1 },
  { id: 'system-marker', re: /<\|system\|>/i, weight: 1 },
  { id: 'system-prefix', re: /(^|\n)\s*system\s*:/i, weight: 0.5 },
  { id: 'jailbreak', re: /\bjailbreak\b/i, weight: 1 },
  { id: 'developer-mode', re: /\b(developer|dan|do\s+anything\s+now)\s+mode\b/i, weight: 1 },
]

const BASE64_RE = /[A-Za-z0-9+/]{40,}={0,2}/g

const walkStrings = (value: unknown, sink: (s: string) => void, seen: WeakSet<object>): void => {
  if (typeof value === 'string') {
    sink(value)
    return
  }
  if (value === null || typeof value !== 'object') return
  if (seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    for (const v of value) walkStrings(v, sink, seen)
    return
  }
  for (const v of Object.values(value as Record<string, unknown>)) {
    walkStrings(v, sink, seen)
  }
}

export const promptInjectionGuardrail = (
  opts: PromptInjectionGuardrailOptions = {},
): FuzeGuardrail<unknown, unknown> => {
  const name = opts.name ?? 'fuze.prompt-injection.heuristic'
  const minBase64 = opts.minBase64Length ?? 200

  return {
    name,
    phase: 'toolResult',
    kind: 'tripwire',
    async evaluate(_ctx, payload): Promise<GuardrailResult> {
      const hits = new Set<string>()
      let score = 0
      const onString = (s: string): void => {
        for (const rule of PATTERNS) {
          if (rule.re.test(s)) {
            if (!hits.has(rule.id)) score += rule.weight
            hits.add(rule.id)
          }
        }
        BASE64_RE.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = BASE64_RE.exec(s)) !== null) {
          if (m[0].length >= minBase64) {
            if (!hits.has('base64-blob')) score += 0.5
            hits.add('base64-blob')
            break
          }
        }
      }
      walkStrings(payload, onString, new WeakSet())
      const patterns = [...hits].sort()
      return {
        tripwire: hits.size > 0,
        evidence: {
          'injection.score': score,
          'injection.patterns': patterns,
        },
      }
    },
  }
}
