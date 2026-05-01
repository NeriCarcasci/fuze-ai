export interface FormatOptions {
  readonly json?: boolean
}

export const formatJson = (value: unknown): string => JSON.stringify(value, null, 2)

export const formatTable = (rows: ReadonlyArray<Readonly<Record<string, unknown>>>): string => {
  if (rows.length === 0) return '(no rows)'
  const first = rows[0]
  if (!first) return '(no rows)'
  const cols = Object.keys(first)
  const widths: Record<string, number> = {}
  for (const c of cols) widths[c] = c.length
  for (const row of rows) {
    for (const c of cols) {
      const v = row[c]
      const s = v === undefined || v === null ? '' : String(v)
      const w = widths[c] ?? 0
      if (s.length > w) widths[c] = s.length
    }
  }
  const pad = (s: string, w: number): string => s + ' '.repeat(Math.max(0, w - s.length))
  const header = cols.map((c) => pad(c, widths[c] ?? c.length)).join('  ')
  const sep = cols.map((c) => '-'.repeat(widths[c] ?? c.length)).join('  ')
  const body = rows
    .map((row) =>
      cols
        .map((c) => {
          const v = row[c]
          const s = v === undefined || v === null ? '' : String(v)
          return pad(s, widths[c] ?? c.length)
        })
        .join('  '),
    )
    .join('\n')
  return [header, sep, body].join('\n')
}

export const renderOutput = (value: unknown, opts: FormatOptions): string => {
  if (opts.json) return formatJson(value)
  if (Array.isArray(value)) {
    return formatTable(value as ReadonlyArray<Record<string, unknown>>)
  }
  return formatJson(value)
}
