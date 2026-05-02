import { describe, it, expect } from 'vitest'
import type { PublicTool, PersonalTool, SpecialCategoryTool } from '@fuze-ai/agent'
import type { ResidencyConstraint } from '@fuze-ai/agent'
import type { ModelProvider } from '../src/residency.js'

declare const usProvider: ModelProvider<'us'>
declare const euProvider: ModelProvider<'eu'>
declare const multiProvider: ModelProvider<'multi'>

declare const publicTool: PublicTool<unknown, unknown, unknown>
declare const personalTool: PersonalTool<unknown, unknown, unknown> & {
  readonly dataClassification: 'personal'
}
declare const businessTool: PersonalTool<unknown, unknown, unknown> & {
  readonly dataClassification: 'business'
}
declare const specialTool: SpecialCategoryTool<unknown, unknown, unknown>

const assertOk = <T,>(_t: T & (unknown extends T ? T : never)): void => undefined
const assertMismatch = <T,>(_t: T & (unknown extends T ? never : T)): void => undefined

const probe = <T,>(): T => undefined as unknown as T

describe('residency type constraint (compile-time)', () => {
  it('public tool compiles with any provider residency', () => {
    assertOk<ResidencyConstraint<typeof usProvider, [typeof publicTool]>>(
      probe<ResidencyConstraint<typeof usProvider, [typeof publicTool]>>(),
    )
    assertOk<ResidencyConstraint<typeof euProvider, [typeof publicTool]>>(
      probe<ResidencyConstraint<typeof euProvider, [typeof publicTool]>>(),
    )
    assertOk<ResidencyConstraint<typeof multiProvider, [typeof publicTool]>>(
      probe<ResidencyConstraint<typeof multiProvider, [typeof publicTool]>>(),
    )
    expect(true).toBe(true)
  })

  it('business tool compiles with any provider residency', () => {
    assertOk<ResidencyConstraint<typeof usProvider, [typeof businessTool]>>(
      probe<ResidencyConstraint<typeof usProvider, [typeof businessTool]>>(),
    )
    assertOk<ResidencyConstraint<typeof multiProvider, [typeof businessTool]>>(
      probe<ResidencyConstraint<typeof multiProvider, [typeof businessTool]>>(),
    )
    expect(true).toBe(true)
  })

  it('personal tool compiles with EU provider, errors with US/multi', () => {
    assertOk<ResidencyConstraint<typeof euProvider, [typeof personalTool]>>(
      probe<ResidencyConstraint<typeof euProvider, [typeof personalTool]>>(),
    )
    assertMismatch<ResidencyConstraint<typeof usProvider, [typeof personalTool]>>(
      probe<ResidencyConstraint<typeof usProvider, [typeof personalTool]>>(),
    )
    assertMismatch<ResidencyConstraint<typeof multiProvider, [typeof personalTool]>>(
      probe<ResidencyConstraint<typeof multiProvider, [typeof personalTool]>>(),
    )

    const probedPU = probe<ResidencyConstraint<typeof usProvider, [typeof personalTool]>>()
    // @ts-expect-error personal tool with US provider must NOT satisfy assertOk
    assertOk<ResidencyConstraint<typeof usProvider, [typeof personalTool]>>(probedPU)
    const probedPM = probe<ResidencyConstraint<typeof multiProvider, [typeof personalTool]>>()
    // @ts-expect-error personal tool with multi provider must NOT satisfy assertOk
    assertOk<ResidencyConstraint<typeof multiProvider, [typeof personalTool]>>(probedPM)
    expect(true).toBe(true)
  })

  it('special-category tool compiles with EU provider, errors with US', () => {
    assertOk<ResidencyConstraint<typeof euProvider, [typeof specialTool]>>(
      probe<ResidencyConstraint<typeof euProvider, [typeof specialTool]>>(),
    )
    assertMismatch<ResidencyConstraint<typeof usProvider, [typeof specialTool]>>(
      probe<ResidencyConstraint<typeof usProvider, [typeof specialTool]>>(),
    )

    const probedSU = probe<ResidencyConstraint<typeof usProvider, [typeof specialTool]>>()
    // @ts-expect-error special-category tool with US provider must NOT satisfy assertOk
    assertOk<ResidencyConstraint<typeof usProvider, [typeof specialTool]>>(probedSU)
    expect(true).toBe(true)
  })

  it('a mixed tool list errors with US provider when any element is personal', () => {
    assertOk<ResidencyConstraint<typeof euProvider, [typeof publicTool, typeof personalTool]>>(
      probe<ResidencyConstraint<typeof euProvider, [typeof publicTool, typeof personalTool]>>(),
    )
    assertMismatch<ResidencyConstraint<typeof usProvider, [typeof publicTool, typeof personalTool]>>(
      probe<ResidencyConstraint<typeof usProvider, [typeof publicTool, typeof personalTool]>>(),
    )

    const probedMU = probe<ResidencyConstraint<typeof usProvider, [typeof publicTool, typeof personalTool]>>()
    // @ts-expect-error mixed list containing a personal tool with US provider must NOT satisfy assertOk
    assertOk<ResidencyConstraint<typeof usProvider, [typeof publicTool, typeof personalTool]>>(probedMU)
    expect(true).toBe(true)
  })
})
