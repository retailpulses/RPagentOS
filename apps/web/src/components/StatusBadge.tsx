const STATUS_LABELS: Record<string, string> = {
  backlog: 'Backlog',
  planned: 'Planned',
  in_progress: 'In Progress',
  waiting_approval: 'Waiting',
  blocked: 'Blocked',
  done: 'Done',
  canceled: 'Canceled',
}

const STATUS_COLORS: Record<string, string> = {
  backlog: 'var(--color-backlog)',
  planned: 'var(--color-planned)',
  in_progress: 'var(--color-in-progress)',
  waiting_approval: 'var(--color-waiting-approval)',
  blocked: 'var(--color-blocked)',
  done: 'var(--color-done)',
  canceled: 'var(--color-canceled)',
}

export default function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] || 'var(--color-text-muted)'
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.3rem',
        fontSize: '0.75rem',
        fontWeight: 500,
        color,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      {STATUS_LABELS[status] || status}
    </span>
  )
}
