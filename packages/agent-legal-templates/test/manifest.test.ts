import { describe, expect, it } from 'vitest'
import {
  manifestDiff,
  manifestHash,
  subProcessorManifest,
} from '../src/manifest.js'
import type { SubProcessor } from '../src/types.js'

const sp = (name: string, country = 'IE'): SubProcessor => ({
  name,
  role: 'inference',
  country,
  residency: 'eu',
  dataCategories: ['prompt-content', 'tool-args'],
  addedAt: '2026-04-01T00:00:00Z',
})

describe('manifestHash', () => {
  it('is deterministic for identical inputs', () => {
    const a = manifestHash([sp('A'), sp('B')])
    const b = manifestHash([sp('A'), sp('B')])
    expect(a).toBe(b)
  })

  it('is order-insensitive (canonical sort by name)', () => {
    const a = manifestHash([sp('A'), sp('B')])
    const b = manifestHash([sp('B'), sp('A')])
    expect(a).toBe(b)
  })

  it('changes when a sub-processor is added', () => {
    const a = manifestHash([sp('A')])
    const b = manifestHash([sp('A'), sp('B')])
    expect(a).not.toBe(b)
  })

  it('changes when a sub-processor is removed', () => {
    const a = manifestHash([sp('A'), sp('B')])
    const b = manifestHash([sp('A')])
    expect(a).not.toBe(b)
  })

  it('changes when a field on an existing entry changes', () => {
    const a = manifestHash([sp('A', 'IE')])
    const b = manifestHash([sp('A', 'US')])
    expect(a).not.toBe(b)
  })
})

describe('manifestDiff', () => {
  it('returns additions correctly', () => {
    const prev = subProcessorManifest([sp('A')])
    const next = subProcessorManifest([sp('A'), sp('B')])
    const d = manifestDiff(prev, next)
    expect(d.added.map((s) => s.name)).toEqual(['B'])
    expect(d.removed).toEqual([])
  })

  it('returns removals correctly', () => {
    const prev = subProcessorManifest([sp('A'), sp('B')])
    const next = subProcessorManifest([sp('A')])
    const d = manifestDiff(prev, next)
    expect(d.removed.map((s) => s.name)).toEqual(['B'])
    expect(d.added).toEqual([])
  })

  it('detects changes on existing entries', () => {
    const prev = subProcessorManifest([sp('A', 'IE')])
    const next = subProcessorManifest([sp('A', 'US')])
    const d = manifestDiff(prev, next)
    expect(d.changed).toHaveLength(1)
    expect(d.changed[0]?.next.country).toBe('US')
  })
})
