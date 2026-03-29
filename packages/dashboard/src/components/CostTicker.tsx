export function CostTicker({ value, prefix = '$' }: { value: number; prefix?: string }) {
  return (
    <span className="font-mono text-sm" style={{ color: 'var(--accent-orange)', fontFamily: 'var(--font-mono)' }}>
      {prefix}{value.toFixed(4)}
    </span>
  )
}
