import { describe, expect, it } from 'vitest'
import { parsePolicy } from '../src/yaml.js'
import { PolicyLoadError } from '../src/types.js'

const valid = `
apiVersion: api.cerbos.dev/v1
resourcePolicy:
  resource: echo
  version: default
  rules:
    - actions: [invoke]
      effect: EFFECT_ALLOW
`

describe('parsePolicy', () => {
  it('loads a valid Cerbos resource policy', () => {
    const p = parsePolicy(valid)
    expect(p.apiVersion).toBe('api.cerbos.dev/v1')
    expect(p.resourcePolicy.resource).toBe('echo')
    expect(p.resourcePolicy.rules).toHaveLength(1)
    expect(p.resourcePolicy.rules[0]?.effect).toBe('EFFECT_ALLOW')
  })

  it('rejects a document missing apiVersion', () => {
    const yaml = `
resourcePolicy:
  resource: echo
  rules:
    - actions: [invoke]
      effect: EFFECT_ALLOW
`
    expect(() => parsePolicy(yaml)).toThrow(PolicyLoadError)
  })

  it('rejects a document missing resourcePolicy.resource', () => {
    const yaml = `
apiVersion: api.cerbos.dev/v1
resourcePolicy:
  rules:
    - actions: [invoke]
      effect: EFFECT_ALLOW
`
    expect(() => parsePolicy(yaml)).toThrow(/resource/)
  })

  it('rejects empty rules', () => {
    const yaml = `
apiVersion: api.cerbos.dev/v1
resourcePolicy:
  resource: echo
  rules: []
`
    expect(() => parsePolicy(yaml)).toThrow(PolicyLoadError)
  })

  it('rejects malformed YAML', () => {
    const yaml = `apiVersion: foo\n  bad: : indent`
    expect(() => parsePolicy(yaml)).toThrow(PolicyLoadError)
  })

  it('parses a condition expression', () => {
    const yaml = `
apiVersion: api.cerbos.dev/v1
resourcePolicy:
  resource: echo
  rules:
    - actions: [invoke]
      effect: EFFECT_ALLOW
      condition:
        match:
          expr: P.attr.tenant == 't-eu'
`
    const p = parsePolicy(yaml)
    expect(p.resourcePolicy.rules[0]?.condition?.match.expr).toBe(
      "P.attr.tenant == 't-eu'",
    )
  })
})
