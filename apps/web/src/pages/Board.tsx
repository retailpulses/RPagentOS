import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTaskList, useUpdateTaskStatus } from '../hooks/useTasks'
import TaskCard from '../components/TaskCard'
import TaskFilters from '../components/TaskFilters'
import type { TaskFilters as TF, TaskStatus } from '@lib/task-types'

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'backlog', label: 'Backlog' },
  { status: 'planned', label: 'Planned' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'waiting_approval', label: 'Waiting Approval' },
  { status: 'blocked', label: 'Blocked' },
  { status: 'done', label: 'Done' },
  { status: 'canceled', label: 'Canceled' },
]

const STATUS_FLOW: Record<TaskStatus, TaskStatus[]> = {
  backlog: ['planned'],
  planned: ['in_progress'],
  in_progress: ['waiting_approval', 'blocked', 'done'],
  waiting_approval: ['in_progress', 'done'],
  blocked: ['in_progress'],
  done: [],
  canceled: [],
}

export default function Board() {
  const [filters, setFilters] = useState<TF>({})
  const { data: tasks, loading, error, refetch } = useTaskList(filters)
  const { update: updateStatus } = useUpdateTaskStatus()

  const handleStatusChange = async (taskId: string, newStatus: TaskStatus) => {
    await updateStatus(taskId, newStatus)
    refetch()
  }

  const getNextStatuses = (current: string): TaskStatus[] => {
    return STATUS_FLOW[current as TaskStatus] || []
  }

  if (loading) return <p>Loading board...</p>
  if (error) return <p style={{ color: 'var(--color-urgent)' }}>{error}</p>

  return (
    <div>
      <div className="page-header">
        <h2>Board</h2>
        <Link to="/tasks/new" className="btn btn-primary">+ New Task</Link>
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <TaskFilters filters={filters} onChange={setFilters} />
      </div>

      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: `repeat(${COLUMNS.length}, 1fr)`,
          minWidth: 0,
          overflowX: 'auto',
        }}
      >
        {COLUMNS.map(col => {
          const columnTasks = tasks.filter(t => t.status === col.status)
          return (
            <div key={col.status} className="flex flex-col gap-2" style={{ minWidth: 220 }}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-sm">{col.label}</span>
                <span className="text-xs text-muted">{columnTasks.length}</span>
              </div>
              {columnTasks.map(t => (
                <div key={t.id}>
                  <TaskCard task={t} />
                  {getNextStatuses(t.status).length > 0 && (
                    <div className="flex gap-1" style={{ marginTop: '0.35rem' }}>
                      {getNextStatuses(t.status).map(next => (
                        <button
                          key={next}
                          className="btn btn-sm"
                          onClick={() => handleStatusChange(t.id, next)}
                          style={{ fontSize: '0.7rem' }}
                        >
                          {'->'} {next.replace(/_/g, ' ')}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {columnTasks.length === 0 && (
                <p className="text-xs text-muted" style={{ padding: '0.5rem 0' }}>
                  No tasks
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
