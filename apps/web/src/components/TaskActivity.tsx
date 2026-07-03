import type { TaskCommentRow, TaskLogRow } from '@lib/task-types'

interface TaskActivityProps {
  comments: TaskCommentRow[]
  logs: TaskLogRow[]
}

export default function TaskActivity({ comments, logs }: TaskActivityProps) {
  const hasAny = comments.length > 0 || logs.length > 0

  if (!hasAny) {
    return <p className="text-sm text-muted">No activity yet.</p>
  }

  return (
    <div className="flex flex-col gap-3">
      {logs.map(l => (
        <div key={l.id} className="flex gap-2 text-sm">
          <span className="text-xs text-muted" style={{ whiteSpace: 'nowrap', minWidth: 60 }}>
            {new Date(l.created_at).toLocaleDateString()}
          </span>
          <span className="text-xs text-muted" style={{ textTransform: 'uppercase', fontWeight: 600, minWidth: 80 }}>
            {l.log_type}
          </span>
          <span className="text-xs text-muted">
            {l.actor_key || l.actor_type || 'system'}
          </span>
          <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {l.message || '(no message)'}
          </span>
        </div>
      ))}

      {comments.map(c => (
        <div key={c.id} className="card flex flex-col gap-1">
          <div className="flex items-center gap-2 text-xs text-muted">
            <span>Comment</span>
            {c.author_key && <span>by {c.author_key}</span>}
            <span>{new Date(c.created_at).toLocaleString()}</span>
          </div>
          <p className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>{c.body}</p>
        </div>
      ))}
    </div>
  )
}
