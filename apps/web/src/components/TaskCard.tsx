import { Link } from 'react-router-dom'
import type { TaskCardRow } from '@lib/task-types'
import StatusBadge from './StatusBadge'
import PriorityBadge from './PriorityBadge'

const PLATFORM_COLORS: Record<string, string> = {
  mercari: 'var(--color-platform-mercari)',
  rakuten: 'var(--color-platform-rakuten)',
  amazon: 'var(--color-platform-amazon)',
}

interface TaskCardProps {
  task: TaskCardRow
}

export default function TaskCard({ task }: TaskCardProps) {
  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'done' && task.status !== 'canceled'

  return (
    <Link to={`/tasks/${task.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div
        className="card"
        style={{
          borderLeft: `3px solid ${task.approval_required ? 'var(--color-waiting-approval)' : 'transparent'}`,
          transition: 'background 0.15s',
          cursor: 'pointer',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-surface-hover)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '' }}
      >
        <div className="flex items-center justify-between gap-2" style={{ marginBottom: '0.35rem' }}>
          <span className="truncate font-medium" style={{ flex: 1 }}>
            {task.title}
          </span>
          <PriorityBadge priority={task.priority} />
        </div>

        <div className="flex items-center gap-3 text-sm text-muted">
          <StatusBadge status={task.status} />

          {task.task_type && (
            <span style={{ fontSize: '0.75rem' }}>{task.task_type}</span>
          )}

          {task.platform && (
            <span
              style={{
                fontSize: '0.7rem',
                color: PLATFORM_COLORS[task.platform] || 'var(--color-text-muted)',
                fontWeight: 600,
                textTransform: 'uppercase',
              }}
            >
              {task.platform}
              {task.shop_code ? ` / ${task.shop_code}` : ''}
            </span>
          )}

          {task.owner_key && (
            <span style={{ fontSize: '0.75rem' }}>{task.owner_key}</span>
          )}
        </div>

        <div className="flex items-center gap-3" style={{ marginTop: '0.35rem' }}>
          {task.due_date && (
            <span
              style={{
                fontSize: '0.75rem',
                color: isOverdue ? 'var(--color-urgent)' : 'var(--color-text-muted)',
              }}
            >
              {isOverdue ? '! ' : ''}Due: {task.due_date}
            </span>
          )}

          {task.target_count !== undefined && task.target_count > 0 && (
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              {task.target_count} target{task.target_count > 1 ? 's' : ''}
            </span>
          )}

          {task.approval_required && (
            <span style={{ fontSize: '0.7rem', color: 'var(--color-waiting-approval)', fontWeight: 600 }}>
              Needs approval
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}
