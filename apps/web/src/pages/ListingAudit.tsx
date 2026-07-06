import { useMemo, useState } from 'react'
import {
  type ListingWorkItem,
  type ListingQwenReview,
  type ListingWorkItemFilters,
  useLatestQwenReview,
  useListingWorkItemOptions,
  useListingWorkItems,
  useRunQwenReview,
  useUpdateListingWorkItemStatus,
} from '../hooks/useListingWorkItems'
import { useCreateTask, useLinkTarget } from '../hooks/useTasks'

const EMPTY_FILTERS: ListingWorkItemFilters = {}

export default function ListingAudit() {
  const [filters, setFilters] = useState<ListingWorkItemFilters>(EMPTY_FILTERS)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const { data, loading, error, refetch } = useListingWorkItems(filters)
  const options = useListingWorkItemOptions()
  const statusUpdate = useUpdateListingWorkItemStatus()
  const qwenRunner = useRunQwenReview()
  const createTask = useCreateTask()
  const linkTarget = useLinkTarget()

  const selected = useMemo(() => {
    return data.find(item => item.id === selectedId) ?? data[0] ?? null
  }, [data, selectedId])
  const qwenReview = useLatestQwenReview(selected?.id)

  const summary = useMemo(() => {
    return {
      total: data.length,
      open: data.filter(item => item.status === 'open').length,
      high: data.filter(item => item.issue_severity === 'high' || item.issue_severity === 'critical').length,
      hero: data.filter(item => item.is_hero).length,
    }
  }, [data])

  const updateFilter = (patch: Partial<ListingWorkItemFilters>) => {
    setSelectedId(null)
    setFilters(current => ({ ...current, ...patch }))
  }

  const handleStatus = async (item: ListingWorkItem, status: string) => {
    setActionError(null)
    const updated = await statusUpdate.update(item.id, status)
    if (!updated && statusUpdate.error) setActionError(statusUpdate.error)
    await refetch()
    setSelectedId(item.id)
  }

  const handleCreateTask = async (item: ListingWorkItem) => {
    setActionError(null)
    const title = taskTitle(item)
    const description = taskDescription(item)
    const task = await createTask.create({
      title,
      description,
      task_type: taskTypeFor(item),
      priority: priorityFor(item),
      platform: item.platform ?? undefined,
      shop_code: item.shop_code ?? undefined,
      source: 'system',
      owner_type: 'human',
      owner_key: 'jim',
      execution_brief: description,
      metadata: {
        source: 'listing_intelligence_workbench',
        work_item_id: item.id,
        workflow_type: item.workflow_type,
        issue_type: item.issue_type,
        recommended_action: item.recommended_action,
        source_snapshot_hash: item.source_snapshot_hash,
      },
    })

    if (!task) {
      setActionError(createTask.error ?? 'Failed to create task')
      return
    }

    const linked = await linkTarget.link(task.id, {
      target_type: item.target_type,
      target_id: item.target_id,
      target_label: targetLabel(item),
      target_ref_json: taskTargetPayload(item),
    })

    if (!linked) {
      setActionError(linkTarget.error ?? 'Task created but target link failed')
      return
    }

    await handleStatus(item, 'task_created')
  }

  const handleRunQwenReview = async (item: ListingWorkItem) => {
    setActionError(null)
    const result = await qwenRunner.run(item.id)
    if (!result.ok) {
      setActionError(result.error ?? 'Failed to run Qwen review')
      return
    }
    await qwenReview.refetch()
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Listing Intelligence</h2>
          <p className="text-sm text-muted mt-2">Supabase-backed listing work queue for MVP-0.</p>
        </div>
        <button className="btn" onClick={() => void refetch()} disabled={loading}>
          Refresh
        </button>
      </div>

      <div className="audit-summary-grid">
        <SummaryMetric label="Work Items" value={summary.total} />
        <SummaryMetric label="Open" value={summary.open} />
        <SummaryMetric label="High" value={summary.high} tone="high" />
        <SummaryMetric label="Hero" value={summary.hero} tone="medium" />
      </div>

      <section className="audit-detail mb-4">
        <div className="listing-filter-grid">
          <FilterSelect label="Platform" value={filters.platform ?? ''} options={options.platforms} onChange={value => updateFilter({ platform: value || undefined })} />
          <FilterSelect label="Shop" value={filters.shopCode ?? ''} options={options.shops} formatOption={shopLabel} onChange={value => updateFilter({ shopCode: value || undefined })} />
          <FilterSelect label="Workflow" value={filters.workflowType ?? ''} options={options.workflowTypes} onChange={value => updateFilter({ workflowType: value || undefined })} />
          <FilterSelect label="Issue" value={filters.issueType ?? ''} options={options.issueTypes} onChange={value => updateFilter({ issueType: value || undefined })} />
          <FilterSelect label="Status" value={filters.status ?? ''} options={options.statuses} onChange={value => updateFilter({ status: value || undefined })} />
          <div className="form-group">
            <label>Search</label>
            <input value={filters.search ?? ''} onChange={event => updateFilter({ search: event.target.value || undefined })} />
          </div>
          <label className="listing-checkbox">
            <input type="checkbox" checked={Boolean(filters.heroOnly)} onChange={event => updateFilter({ heroOnly: event.target.checked || undefined })} />
            Hero only
          </label>
        </div>
      </section>

      {error && <p className="audit-error mb-4">{error}</p>}
      {actionError && <p className="audit-error mb-4">{actionError}</p>}

      <div className="audit-results-layout">
        <section className="audit-result-list">
          {loading && <p className="text-sm text-muted">Loading...</p>}
          {!loading && data.length === 0 && <p className="text-sm text-muted">No work items found.</p>}
          {data.map(item => (
            <button
              key={item.id}
              className={`audit-result-row ${selected?.id === item.id ? 'active' : ''}`}
              onClick={() => setSelectedId(item.id)}
            >
              <span>
                <strong>{targetLabel(item)}</strong>
                <small>{item.workflow_type} / {item.issue_type ?? 'strategy'} / {item.status}</small>
              </span>
              <span className={`audit-priority ${priorityTone(item.issue_severity)}`}>{item.issue_severity}</span>
            </button>
          ))}
        </section>

        {selected && (
          <WorkItemDetail
            item={selected}
            review={qwenReview.data}
            reviewLoading={qwenReview.loading}
            busy={statusUpdate.loading || createTask.loading || linkTarget.loading || qwenRunner.loading}
            onIgnore={() => void handleStatus(selected, 'ignored')}
            onWaitingInput={() => void handleStatus(selected, 'waiting_for_input')}
            onCreateTask={() => void handleCreateTask(selected)}
            onRunQwenReview={() => void handleRunQwenReview(selected)}
          />
        )}
      </div>
    </div>
  )
}

function SummaryMetric({ label, value, tone }: { label: string; value: number; tone?: 'high' | 'medium' }) {
  return (
    <div className={`audit-metric ${tone ?? ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function FilterSelect({ label, value, options, formatOption, onChange }: {
  label: string
  value: string
  options: string[]
  formatOption?: (value: string) => string
  onChange: (value: string) => void
}) {
  return (
    <div className="form-group">
      <label>{label}</label>
      <select value={value} onChange={event => onChange(event.target.value)}>
        <option value="">All</option>
        {options.map(option => <option key={option} value={option}>{formatOption ? formatOption(option) : option}</option>)}
      </select>
    </div>
  )
}

function WorkItemDetail({ item, review, reviewLoading, busy, onIgnore, onWaitingInput, onCreateTask, onRunQwenReview }: {
  item: ListingWorkItem
  review: ListingQwenReview | null
  reviewLoading: boolean
  busy: boolean
  onIgnore: () => void
  onWaitingInput: () => void
  onCreateTask: () => void
  onRunQwenReview: () => void
}) {
  const qwenEligible = isQwenEligible(item)
  return (
    <article className="audit-detail">
      <div className="flex justify-between gap-3 mb-4">
        <div>
          <h3>{targetLabel(item)}</h3>
          <p className="text-xs text-muted">{item.platform ?? 'all platforms'} / {shopLabel(item.shop_code)} / {item.target_type}</p>
        </div>
        <div className="audit-score">{Math.round(item.priority_score)}</div>
      </div>

      <div className="audit-recommendation mb-4">
        <span className={`audit-priority ${priorityTone(item.issue_severity)}`}>{item.issue_severity}</span>
        <strong>{item.recommended_action ?? item.workflow_type}</strong>
        <p>{item.workflow_type} / {item.issue_type ?? 'strategy'} / {item.human_input_level}</p>
      </div>

      <div className="audit-toolbar">
        <button className="btn" disabled={busy} onClick={onIgnore}>Ignore</button>
        <button className="btn" disabled={busy} onClick={onWaitingInput}>Mark Waiting Input</button>
        <button className="btn btn-primary" disabled={busy} onClick={onCreateTask}>Create Task</button>
        <button className="btn" disabled={busy || !qwenEligible} onClick={onRunQwenReview}>Run Qwen Review</button>
      </div>
      {!qwenEligible && <p className="text-xs text-muted mt-2">Qwen MVP-1 runs only for mapped Rakuten/Amazon audit items.</p>}

      <IssueBlock title="Trace" rows={[
        ['Family', item.product_family_id],
        ['SPU', item.product_spu_id],
        ['Variant', item.variant_id],
        ['Listing', item.listing_id],
        ['Listing SKU', item.listing_sku_id],
        ['Snapshot', item.source_snapshot_hash ? `${item.source_snapshot_hash.slice(0, 12)} / v${item.source_snapshot_version}` : `v${item.source_snapshot_version}`],
      ]} />
      <JsonBlock title="Classification Reasons" value={item.classification_reasons} />
      <JsonBlock title="Deterministic Findings" value={item.deterministic_findings} />
      <QwenReviewBlock review={review} loading={reviewLoading} />
      <JsonBlock title="Source Context" value={item.source_context} />
    </article>
  )
}

function QwenReviewBlock({ review, loading }: { review: ListingQwenReview | null; loading: boolean }) {
  if (loading) {
    return (
      <section className="audit-issue-block">
        <h4>Qwen Review</h4>
        <p className="text-sm text-muted">Loading review...</p>
      </section>
    )
  }

  if (!review) {
    return (
      <section className="audit-issue-block">
        <h4>Qwen Review</h4>
        <p className="text-sm text-muted">No Qwen review yet.</p>
      </section>
    )
  }

  return (
    <section className="audit-issue-block">
      <h4>Qwen Review</h4>
      <div className="audit-recommendation mb-3">
        <span className={`audit-priority ${priorityTone(review.risk_level)}`}>{review.validation_status}</span>
        <strong>{review.summary ?? 'Qwen review saved'}</strong>
        <p>{review.llm_model} / {review.prompt_profile} / repairs {review.repair_attempts}</p>
      </div>
      <IssueBlock title="Qwen Trace" rows={[
        ['Review', review.id],
        ['Result', review.result_id],
        ['Snapshot', review.source_snapshot_hash ? `${review.source_snapshot_hash.slice(0, 12)} / v${review.source_snapshot_version ?? '-'}` : '-'],
      ]} />
      <JsonBlock title="Qwen Issues" value={review.issues} />
      <JsonBlock title="Qwen Recommendations" value={review.recommendations} />
      {review.suggested_title && <JsonBlock title="Suggested Title" value={review.suggested_title} />}
      {review.suggested_description && <JsonBlock title="Suggested Description" value={review.suggested_description} />}
      {review.validation_errors.length > 0 && <JsonBlock title="Validation Errors" value={review.validation_errors} />}
    </section>
  )
}

function IssueBlock({ title, rows }: { title: string; rows: Array<[string, string | null]> }) {
  return (
    <section className="audit-issue-block">
      <h4>{title}</h4>
      <dl className="listing-trace">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value ?? '-'}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <section className="audit-issue-block">
      <h4>{title}</h4>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </section>
  )
}

function priorityTone(value: string) {
  if (value === 'critical' || value === 'high') return 'high'
  if (value === 'medium') return 'medium'
  return 'low'
}

function isQwenEligible(item: ListingWorkItem) {
  const findingText = JSON.stringify([item.classification_reasons, item.deterministic_findings]).toLowerCase()
  return (
    item.workflow_type === 'audit_existing_listing'
    && (item.platform === 'rakuten' || item.platform === 'amazon')
    && item.issue_type !== 'missing_mapping'
    && item.recommended_action !== 'create_mapping_task'
    && !findingText.includes('missing_mapping')
    && !findingText.includes('create_mapping_task')
  )
}

function shopLabel(value: string | null | undefined) {
  if (!value) return 'all shops'
  const labels: Record<string, string> = {
    homebliss: 'rakuten',
    jp: 'amazon',
    shop4: 'mercari shop4',
  }
  return labels[value] ?? value
}

function targetLabel(item: ListingWorkItem) {
  const context = item.source_context ?? {}
  return String(
    context['title']
    ?? context['spu_code']
    ?? context['seller_sku']
    ?? context['external_listing_id']
    ?? item.target_key
  )
}

function priorityFor(item: ListingWorkItem) {
  if (item.issue_severity === 'critical') return 'urgent'
  if (item.issue_severity === 'high') return 'high'
  if (item.issue_severity === 'low') return 'low'
  return 'medium'
}

function taskTypeFor(item: ListingWorkItem) {
  if (item.issue_type === 'missing_images') return 'listing_image_update'
  if (item.issue_type === 'missing_mapping') return 'product_mapping_review'
  if (item.issue_type === 'price_missing' || item.issue_type === 'price_stock_mismatch') return 'pricing_review'
  if (item.workflow_type === 'optimize_hero_listing') return 'hero_listing_strategy'
  return 'listing_content_update'
}

function taskTitle(item: ListingWorkItem) {
  return `[${item.workflow_type}] ${targetLabel(item)}`.slice(0, 180)
}

function taskDescription(item: ListingWorkItem) {
  return [
    `Workflow: ${item.workflow_type}`,
    `Issue: ${item.issue_type ?? '-'}`,
    `Recommended action: ${item.recommended_action ?? '-'}`,
    `Platform: ${item.platform ?? '-'}`,
    `Shop: ${shopLabel(item.shop_code)}`,
    `Target: ${item.target_type} ${item.target_id}`,
    `Snapshot: ${item.source_snapshot_hash ?? '-'}`,
    '',
    'Classification reasons:',
    JSON.stringify(item.classification_reasons, null, 2),
  ].join('\n')
}

function taskTargetPayload(item: ListingWorkItem) {
  return {
    work_item_id: item.id,
    workflow_type: item.workflow_type,
    issue_type: item.issue_type,
    recommended_action: item.recommended_action,
    platform: item.platform,
    shop_code: item.shop_code,
    product_family_id: item.product_family_id,
    product_spu_id: item.product_spu_id,
    variant_id: item.variant_id,
    bundle_id: item.bundle_id,
    listing_id: item.listing_id,
    listing_sku_id: item.listing_sku_id,
    source_snapshot_hash: item.source_snapshot_hash,
  }
}
