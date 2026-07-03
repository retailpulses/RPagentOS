import type { TaskTargetRow } from '@lib/task-types'

interface TaskTargetsProps {
  targets: TaskTargetRow[]
}

export default function TaskTargets({ targets }: TaskTargetsProps) {
  if (targets.length === 0) {
    return <p className="text-sm text-muted">No targets linked.</p>
  }

  return (
    <div className="flex flex-col gap-2">
      {targets.map(t => (
        <div key={t.id} className="card flex items-center justify-between">
          <div>
            <span className="text-xs text-muted" style={{ textTransform: 'uppercase', fontWeight: 600 }}>
              {t.target_type}
            </span>
            <p className="text-sm font-medium">{t.target_label || t.target_id}</p>
            {t.target_id && t.target_label && (
              <p className="text-xs text-muted">ID: {t.target_id}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
