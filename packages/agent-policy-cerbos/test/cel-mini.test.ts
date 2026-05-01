import { describe, expect, it } from 'vitest'
import { evaluateCel, type CelBindings } from '../src/cel-mini.js'

const mk = (
  r: Record<string, unknown> = {},
  p: Record<string, unknown> = {},
): CelBindings => ({ R: { attr: r }, P: { attr: p } })

describe('cel-mini', () => {
  it('evaluates equality', () => {
    expect(evaluateCel("R.attr.kind == 'read'", mk({ kind: 'read' }))).toBe(true)
    expect(evaluateCel("R.attr.kind == 'read'", mk({ kind: 'write' }))).toBe(false)
  })

  it('evaluates inequality', () => {
    expect(evaluateCel("R.attr.kind != 'read'", mk({ kind: 'write' }))).toBe(true)
    expect(evaluateCel("R.attr.kind != 'read'", mk({ kind: 'read' }))).toBe(false)
  })

  it('evaluates membership in a list', () => {
    expect(
      evaluateCel("R.attr.region in ['eu', 'eea']", mk({ region: 'eu' })),
    ).toBe(true)
    expect(
      evaluateCel("R.attr.region in ['eu', 'eea']", mk({ region: 'us' })),
    ).toBe(false)
  })

  it('combines clauses with &&', () => {
    expect(
      evaluateCel(
        "R.attr.kind == 'read' && P.attr.tenant == 't-eu'",
        mk({ kind: 'read' }, { tenant: 't-eu' }),
      ),
    ).toBe(true)
    expect(
      evaluateCel(
        "R.attr.kind == 'read' && P.attr.tenant == 't-eu'",
        mk({ kind: 'read' }, { tenant: 't-us' }),
      ),
    ).toBe(false)
  })

  it('combines clauses with ||', () => {
    expect(
      evaluateCel(
        "P.attr.tenant == 't-eu' || P.attr.tenant == 't-eea'",
        mk({}, { tenant: 't-eea' }),
      ),
    ).toBe(true)
    expect(
      evaluateCel(
        "P.attr.tenant == 't-eu' || P.attr.tenant == 't-eea'",
        mk({}, { tenant: 't-us' }),
      ),
    ).toBe(false)
  })

  it('returns false for a missing attribute', () => {
    expect(evaluateCel("R.attr.absent == 'x'", mk({}))).toBe(false)
  })

  it('mixes R.attr and P.attr in a single expression', () => {
    expect(
      evaluateCel(
        "R.attr.kind == 'read' && P.attr.principal == 'p1'",
        mk({ kind: 'read' }, { principal: 'p1' }),
      ),
    ).toBe(true)
  })

  it('respects && precedence over || (a || b && c)', () => {
    // Parser splits || at top level first, so `a || b && c` = a OR (b && c)
    expect(
      evaluateCel(
        "R.attr.x == 'a' || R.attr.y == 'b' && R.attr.z == 'c'",
        mk({ x: 'a', y: 'no', z: 'no' }),
      ),
    ).toBe(true)
    expect(
      evaluateCel(
        "R.attr.x == 'a' || R.attr.y == 'b' && R.attr.z == 'c'",
        mk({ x: 'no', y: 'b', z: 'no' }),
      ),
    ).toBe(false)
  })
})
