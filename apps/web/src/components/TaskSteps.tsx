import type { TaskStepRow } from '@lib/task-types'

interface TaskStepsProps {
  steps: TaskStepRow[]
}

const STEP_STATUS_COLORS: Record<string, string> = {
  todo: 'var(--color-text-muted)',
  in_progress: 'var(--color-in-progress)',
  blocked: 'var(--color-blocked)',
  done: 'var(--color-done)',
  skipped: 'var(--color-canceled)',
}

const STEP_STATUS_ICONS: Record<string, string> = {
  todo: 'O',
  in_progress: '~',
  blocked: '!',
  done: 'x',
  skipped: '-',
}

export default function TaskSteps({ steps }: TaskStepsProps) {
  if (steps.length === 0) {
    return <p className="text-sm text-muted">No steps defined.</p>
  }

  return (
    <div className="flex flex-col gap-2">
      {steps.map(s => (
        <div key={s.id} className="flex gap-2 items-start">
          <span
            style={{
              color: STEP_STATUS_COLORS[s.status] || 'var(--color-text-muted)',
              fontSize: '1rem',
              lineHeight: 1.5,
              width: 16,
              textAlign: 'center',
            }}
          >
            {STEP_STATUS_ICONS[s.status] || 'O'}
          </span>
          <div style={{ flex: 1 }}>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{s.title}</span>
              <span
                style={{
                  fontSize: '0.7rem',
                  color: STEP_STATUS_COLORS[s.status] || 'var(--color-text-muted)',
                  textTransform: 'uppercase',
                }}
              >
                {s.status}
              </span>
            </div>
            {s.description && (
              <p className="text-xs text-muted">{s.description}</p>
            )}
            {s.owner_key && (
              <p className="text-xs text-muted">Owner: {s.owner_key}</p>
            )}
            {s.completed_at && (
              <p className="text-xs text-muted">Completed: {new Date(s.completed_at).toLocaleString()}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
