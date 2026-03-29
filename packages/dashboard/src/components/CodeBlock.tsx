export function CodeBlock({ value }: { value: unknown }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return (
    <pre
      className="rounded-lg p-3 overflow-auto text-xs"
      style={{
        backgroundColor: 'var(--bg-elevated)',
        color: 'var(--text-secondary)',
        fontFamily: 'var(--font-mono)',
        maxHeight: '300px',
      }}
    >
      <code>{text}</code>
    </pre>
  )
}
