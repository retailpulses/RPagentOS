const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'var(--color-urgent)',
  high: 'var(--color-high)',
  medium: 'var(--color-medium)',
  low: 'var(--color-low)',
}

export default function PriorityBadge({ priority }: { priority: string }) {
  const color = PRIORITY_COLORS[priority] || 'var(--color-text-muted)'
  return (
    <span
      style={{
        fontSize: '0.7rem',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color,
      }}
    >
      {priority}
    </span>
  )
}
