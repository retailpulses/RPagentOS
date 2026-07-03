import { useState } from 'react'
import { useTaskSelectOptions } from '../hooks/useTasks'
import type { TaskFilters as TF } from '@lib/task-types'

interface TaskFiltersProps {
  filters: TF
  onChange: (filters: TF) => void
}

export default function TaskFilters({ filters, onChange }: TaskFiltersProps) {
  const [search, setSearch] = useState(filters.search || '')
  const priorityOptions = useTaskSelectOptions('priority')
  const taskTypeOptions = useTaskSelectOptions('task_type')
  const platformOptions = useTaskSelectOptions('platform')

  const update = (patch: Partial<TF>) => {
    onChange({ ...filters, ...patch })
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    update({ search: search || undefined })
  }

  return (
    <div className="card flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
      <form onSubmit={handleSearch} className="flex gap-2 items-center">
        <input
          type="text"
          placeholder="Search tasks..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            padding: '0.35rem 0.6rem',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg)',
            color: 'var(--color-text)',
            width: 180,
            fontSize: '0.85rem',
          }}
        />
        <button type="submit" className="btn btn-sm">Search</button>
      </form>

      <select
        value={(filters.priority && filters.priority[0]) || ''}
        onChange={e => {
          const val = e.target.value
          update({ priority: val ? [val] : undefined })
        }}
        style={{
          padding: '0.35rem 0.6rem',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--color-border)',
          background: 'var(--color-bg)',
          color: 'var(--color-text)',
          fontSize: '0.85rem',
        }}
      >
        <option value="">All priorities</option>
        {priorityOptions.data.map(option => (
          <option key={option.option_key} value={option.option_key}>{option.label}</option>
        ))}
      </select>

      <select
        value={(filters.task_type && filters.task_type[0]) || ''}
        onChange={e => {
          const val = e.target.value
          update({ task_type: val ? [val] : undefined })
        }}
        style={{
          padding: '0.35rem 0.6rem',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--color-border)',
          background: 'var(--color-bg)',
          color: 'var(--color-text)',
          fontSize: '0.85rem',
        }}
      >
        <option value="">All types</option>
        {taskTypeOptions.data.map(option => (
          <option key={option.option_key} value={option.option_key}>{option.label}</option>
        ))}
      </select>

      <select
        value={filters.platform || ''}
        onChange={e => update({ platform: e.target.value || undefined })}
        style={{
          padding: '0.35rem 0.6rem',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--color-border)',
          background: 'var(--color-bg)',
          color: 'var(--color-text)',
          fontSize: '0.85rem',
        }}
      >
        <option value="">All platforms</option>
        {platformOptions.data.map(option => (
          <option key={option.option_key} value={option.option_key}>{option.label}</option>
        ))}
      </select>
    </div>
  )
}
