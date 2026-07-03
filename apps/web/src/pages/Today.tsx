import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTaskList } from '../hooks/useTasks'
import TaskCard from '../components/TaskCard'
import type { TaskCardRow } from '@lib/task-types'

type GroupKey = 'overdue' | 'due_today' | 'scheduled_today' | 'due_this_week' | 'waiting_approval' | 'blocked' | 'open_without_date'

const GROUP_LABELS: Record<GroupKey, string> = {
  overdue: 'Overdue',
  due_today: 'Due Today',
  scheduled_today: 'Scheduled Today',
  due_this_week: 'Due This Week',
  waiting_approval: 'Waiting Approval',
  blocked: 'Blocked',
  open_without_date: 'Open Without Date',
}

const GROUP_ORDER: GroupKey[] = [
  'overdue',
  'due_today',
  'scheduled_today',
  'due_this_week',
  'waiting_approval',
  'blocked',
  'open_without_date',
]

function groupTasks(tasks: TaskCardRow[]): Map<GroupKey, TaskCardRow[]> {
  const groups = new Map<GroupKey, TaskCardRow[]>()
  for (const key of GROUP_ORDER) groups.set(key, [])

  const todayStr = new Date().toISOString().slice(0, 10)
  const today = new Date(todayStr)
  const weekEnd = new Date(today)
  weekEnd.setDate(weekEnd.getDate() + 7)

  for (const task of tasks) {
    if (task.status === 'done' || task.status === 'canceled') continue

    if (task.status === 'blocked') {
      groups.get('blocked')!.push(task)
      continue
    }

    if (task.status === 'waiting_approval') {
      groups.get('waiting_approval')!.push(task)
    }

    if (task.due_date) {
      const due = new Date(task.due_date)
      if (due < today) {
        groups.get('overdue')!.push(task)
      } else if (due.toISOString().slice(0, 10) === todayStr) {
        groups.get('due_today')!.push(task)
      } else if (due <= weekEnd) {
        groups.get('due_this_week')!.push(task)
      }
    }

    if (task.scheduled_start_at) {
      const scheduled = new Date(task.scheduled_start_at).toISOString().slice(0, 10)
      if (scheduled === todayStr) {
        groups.get('scheduled_today')!.push(task)
      }
    }

    if (
      !task.due_date
      && !task.scheduled_start_at
      && (task.status === 'backlog' || task.status === 'planned' || task.status === 'in_progress')
    ) {
      groups.get('open_without_date')!.push(task)
    }
  }

  return groups
}

function sortByPriority(tasks: TaskCardRow[]): TaskCardRow[] {
  const rank: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }
  return [...tasks].sort((a, b) => (rank[a.priority] ?? 99) - (rank[b.priority] ?? 99))
}

export default function Today() {
  const { data: allTasks, loading, error } = useTaskList()
  const groups = useMemo(() => groupTasks(allTasks), [allTasks])

  if (loading) return <p>Loading tasks...</p>
  if (error) return <p style={{ color: 'var(--color-urgent)' }}>{error}</p>

  return (
    <div>
      <div className="page-header">
        <h2>Today</h2>
        <Link to="/tasks/new" className="btn btn-primary">+ New Task</Link>
      </div>

      <div className="flex flex-col gap-4">
        {GROUP_ORDER.map(key => {
          const tasks = sortByPriority(groups.get(key) || [])
          if (tasks.length === 0) return null
          return (
            <section key={key}>
              <h3 className="font-semibold mb-2" style={{ fontSize: '0.95rem' }}>
                {GROUP_LABELS[key]}
                <span className="text-muted font-medium" style={{ marginLeft: '0.5rem', fontSize: '0.85rem' }}>
                  {tasks.length}
                </span>
              </h3>
              <div className="flex flex-col gap-2">
                {tasks.map(t => <TaskCard key={t.id} task={t} />)}
              </div>
            </section>
          )
        })}

        {Array.from(groups.values()).every(t => t.length === 0) && (
          <p className="text-muted">No tasks for today. Great work!</p>
        )}
      </div>
    </div>
  )
}
