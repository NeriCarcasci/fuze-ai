const SEVERITY_STYLES: Record<string, { bg: string; text: string }> = {
  warning: { bg: '#f39c1220', text: '#f39c12' },
  action: { bg: '#ff6b3520', text: '#ff6b35' },
  critical: { bg: '#e74c3c20', text: '#e74c3c' },
}

export function GuardEventBadge({ eventType, severity }: { eventType: string; severity: string }) {
  const style = SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.warning
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-xs"
      style={{ backgroundColor: style.bg, color: style.text }}
      title={eventType}
    >
      {eventType.replace(/_/g, ' ')}
    </span>
  )
}
