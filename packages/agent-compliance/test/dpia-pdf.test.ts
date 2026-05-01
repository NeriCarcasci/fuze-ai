import { describe, expect, it } from 'vitest'
import type { DpiaDocument } from '../src/dpia.js'
import { generateDpiaPdf } from '../src/dpia-pdf.js'

interface CapturedCall {
  readonly method: string
  readonly args: readonly unknown[]
}

const makeFakePdfKit = (): {
  module: () => Promise<{ default: new () => unknown }>
  calls: CapturedCall[]
} => {
  const calls: CapturedCall[] = []
  class FakeDoc {
    private dataListeners: ((chunk: Buffer) => void)[] = []
    private endListeners: (() => void)[] = []
    private record(method: string, args: readonly unknown[]): this {
      calls.push({ method, args })
      return this
    }
    fontSize(size: number): this {
      return this.record('fontSize', [size])
    }
    font(name: string): this {
      return this.record('font', [name])
    }
    text(text: string, options?: Readonly<Record<string, unknown>>): this {
      const args = options === undefined ? [text] : [text, options]
      return this.record('text', args)
    }
    moveDown(lines?: number): this {
      return this.record('moveDown', lines === undefined ? [] : [lines])
    }
    addPage(): this {
      return this.record('addPage', [])
    }
    on(event: string, listener: (...args: never[]) => void): this {
      if (event === 'data') this.dataListeners.push(listener as never)
      if (event === 'end') this.endListeners.push(listener as never)
      return this
    }
    end(): void {
      const payload = Buffer.from('FAKE-PDF-' + 'x'.repeat(2048), 'utf8')
      for (const fn of this.dataListeners) fn(payload)
      for (const fn of this.endListeners) fn()
    }
  }
  return {
    module: async () => ({ default: FakeDoc }),
    calls,
  }
}

const buildDpia = (): DpiaDocument => ({
  version: '1',
  purpose: 'Triage incoming customer requests with EU-only tools.',
  lawfulBasis: 'contract',
  tools: [
    {
      name: 'echo',
      description: 'echoes input',
      dataClassification: 'public',
      residencyRequired: 'n/a',
      allowedLawfulBases: 'inherit',
    },
    {
      name: 'lookup-customer',
      description: 'looks up a customer by id',
      dataClassification: 'personal',
      residencyRequired: 'eu',
      allowedLawfulBases: ['contract'],
    },
  ],
  residencySummary: {
    euOnlyToolCount: 1,
    euApprovedToolCount: 0,
    anyResidencyToolCount: 0,
  },
  annexIIIDomain: 'employment',
  producesArt22Decision: true,
  oversightPlanRef: { id: 'op.v1', trainingId: 'cert-2026' },
  retention: {
    id: 'r.v1',
    hashTtlDays: 30,
    fullContentTtlDays: 7,
    decisionTtlDays: 90,
  },
  subProcessors: [
    { name: 'EU Cloud Provider', role: 'hosting', residency: 'eu' },
  ],
  risks: [
    {
      kind: 'high-risk-domain',
      description: 'Annex III: employment',
    },
    {
      kind: 'automated-decision',
      description: 'Art 22 automated decisions present.',
    },
  ],
})

describe('generateDpiaPdf', () => {
  it('produces a non-empty Buffer', async () => {
    const fake = makeFakePdfKit()
    const buf = await generateDpiaPdf(buildDpia(), { loadPdfKit: fake.module as never })
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBeGreaterThan(0)
  })

  it('writes more than 1KB for a populated DPIA', async () => {
    const fake = makeFakePdfKit()
    const buf = await generateDpiaPdf(buildDpia(), { loadPdfKit: fake.module as never })
    expect(buf.length).toBeGreaterThan(1024)
  })

  it('renders the load-bearing fields (purpose, tools, risks, sub-processors)', async () => {
    const fake = makeFakePdfKit()
    await generateDpiaPdf(buildDpia(), { loadPdfKit: fake.module as never })
    const allText = fake.calls
      .filter((c) => c.method === 'text')
      .map((c) => String(c.args[0]))
      .join('\n')
    expect(allText).toContain('Triage incoming customer requests')
    expect(allText).toContain('echo')
    expect(allText).toContain('lookup-customer')
    expect(allText).toContain('employment')
    expect(allText).toContain('EU Cloud Provider')
    expect(allText).toContain('automated-decision')
  })

  it('throws a clear error when pdfkit cannot be loaded', async () => {
    await expect(
      generateDpiaPdf(buildDpia(), {
        loadPdfKit: async () => {
          throw new Error('Cannot find module pdfkit')
        },
      }),
    ).rejects.toThrow(/pdfkit/)
  })
})
