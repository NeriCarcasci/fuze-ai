import type { DpiaDocument } from './dpia.js'

interface PdfDocLike {
  fontSize(size: number): PdfDocLike
  font(name: string): PdfDocLike
  text(text: string, options?: Readonly<Record<string, unknown>>): PdfDocLike
  moveDown(lines?: number): PdfDocLike
  addPage(): PdfDocLike
  on(event: 'data', listener: (chunk: Buffer) => void): PdfDocLike
  on(event: 'end', listener: () => void): PdfDocLike
  on(event: 'error', listener: (err: Error) => void): PdfDocLike
  end(): void
}

interface PdfKitModule {
  default: new (opts?: Readonly<Record<string, unknown>>) => PdfDocLike
}

export interface GenerateDpiaPdfOptions {
  readonly title?: string
  readonly loadPdfKit?: () => Promise<PdfKitModule>
}

const defaultLoader = async (): Promise<PdfKitModule> => {
  const moduleName = 'pdfkit'
  try {
    const mod = (await import(moduleName)) as unknown as {
      default?: new (opts?: Readonly<Record<string, unknown>>) => PdfDocLike
    }
    if (!mod.default) {
      throw new Error('pdfkit: no default export found')
    }
    return { default: mod.default }
  } catch (e) {
    throw new Error(
      'generateDpiaPdf requires pdfkit as an optional peer dependency; install it with `npm i pdfkit`',
      { cause: e },
    )
  }
}

export const generateDpiaPdf = async (
  dpia: DpiaDocument,
  opts: GenerateDpiaPdfOptions = {},
): Promise<Buffer> => {
  const loader = opts.loadPdfKit ?? defaultLoader
  const mod = await loader()
  const PDFDocument = mod.default
  const doc = new PDFDocument({ size: 'A4', margin: 50 })

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', (err) => reject(err))

    renderDpia(doc, dpia, opts.title ?? 'Data Protection Impact Assessment')
    doc.end()
  })
}

const renderDpia = (doc: PdfDocLike, dpia: DpiaDocument, title: string): void => {
  doc.fontSize(20).text(title)
  doc.moveDown(0.5)
  doc.fontSize(10).text(`DPIA version ${dpia.version}`)
  doc.moveDown(1)

  doc.fontSize(14).text('Purpose')
  doc.fontSize(11).text(dpia.purpose)
  doc.moveDown(0.5)

  doc.fontSize(14).text('Lawful basis')
  doc.fontSize(11).text(dpia.lawfulBasis)
  doc.moveDown(0.5)

  doc.fontSize(14).text('Annex III domain')
  doc.fontSize(11).text(dpia.annexIIIDomain)
  doc.moveDown(0.5)

  doc.fontSize(14).text('Article 22 automated decision-making')
  doc.fontSize(11).text(dpia.producesArt22Decision ? 'Yes' : 'No')
  doc.moveDown(0.5)

  doc.fontSize(14).text('Oversight plan')
  if (dpia.oversightPlanRef) {
    const trainingId = dpia.oversightPlanRef.trainingId
      ? `, trainingId=${dpia.oversightPlanRef.trainingId}`
      : ''
    doc.fontSize(11).text(`id=${dpia.oversightPlanRef.id}${trainingId}`)
  } else {
    doc.fontSize(11).text('(none)')
  }
  doc.moveDown(0.5)

  doc.fontSize(14).text('Retention policy')
  doc
    .fontSize(11)
    .text(
      `id=${dpia.retention.id}, hashTtlDays=${dpia.retention.hashTtlDays}, fullContentTtlDays=${dpia.retention.fullContentTtlDays}, decisionTtlDays=${dpia.retention.decisionTtlDays}`,
    )
  doc.moveDown(0.5)

  doc.fontSize(14).text('Residency summary')
  doc
    .fontSize(11)
    .text(
      `EU-only tools: ${dpia.residencySummary.euOnlyToolCount}, EU-approved: ${dpia.residencySummary.euApprovedToolCount}, any: ${dpia.residencySummary.anyResidencyToolCount}`,
    )
  doc.moveDown(1)

  doc.fontSize(14).text(`Tools (${dpia.tools.length})`)
  doc.fontSize(10)
  for (const t of dpia.tools) {
    const allowedBases =
      t.allowedLawfulBases === 'inherit' ? 'inherit' : t.allowedLawfulBases.join(', ')
    doc.text(
      `- ${t.name} [${t.dataClassification}] residency=${t.residencyRequired}; bases=${allowedBases}`,
    )
    doc.text(`    ${t.description}`)
  }
  doc.moveDown(1)

  doc.fontSize(14).text(`Risk findings (${dpia.risks.length})`)
  doc.fontSize(10)
  if (dpia.risks.length === 0) {
    doc.text('No risks detected.')
  } else {
    for (const r of dpia.risks) {
      const tools = r.toolNames && r.toolNames.length > 0 ? ` (tools: ${r.toolNames.join(', ')})` : ''
      doc.text(`- [${r.kind}] ${r.description}${tools}`)
    }
  }
  doc.moveDown(1)

  doc.fontSize(14).text(`Sub-processors (${dpia.subProcessors.length})`)
  doc.fontSize(10)
  if (dpia.subProcessors.length === 0) {
    doc.text('No sub-processors configured.')
  } else {
    for (const p of dpia.subProcessors) {
      doc.text(`- ${p.name} (${p.role}) — residency=${p.residency}`)
    }
  }
}
