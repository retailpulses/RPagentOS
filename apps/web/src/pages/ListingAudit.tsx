import { useMemo, useState } from 'react'
import {
  type ListingWorkItem,
  type ListingQwenReview,
  type ListingWorkItemFilters,
  type ListingReviewResult,
  type ListingCycleState,
  useLatestQwenReview,
  useListingReviewResult,
  useListingWorkItemOptions,
  useListingWorkItems,
  useRunQwenReview,
  useUpdateListingWorkItemStatus,
} from '../hooks/useListingWorkItems'
import { useCreateTask, useLinkTarget } from '../hooks/useTasks'
import { useEnqueueReReview, useLatestCycle, useLatestCycleResult } from '../hooks/useListingWorkItems'
import { useCycleActions } from '../hooks/useCycleActions'

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

  const qualityResult = useListingReviewResult(selected?.latest_result_id)
  const qwenReview = useLatestQwenReview(selected?.id)
  const cycle = useLatestCycle(selected?.listing_id)
  const cycleResult = useLatestCycleResult(cycle.data)
  const cycleActions = useCycleActions()
  const reReview = useEnqueueReReview()

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
    window.setTimeout(() => { void qwenReview.refetch() }, 3000)
    window.setTimeout(() => { void qwenReview.refetch() }, 10000)
  }

  const handleReReview = async (item: ListingWorkItem) => {
    setActionError(null)
    if (!item.listing_id) {
      setActionError('No listing ID available for this work item')
      return
    }
    const result = await reReview.enqueue(item.listing_id, item.platform ?? 'mercari')
    if (!result.ok) {
      setActionError(result.error ?? 'Failed to enqueue re-review')
      return
    }
    await cycle.refetch()
  }

  const handleCycleApprove = async (cycleState: { id: string }) => {
    setActionError(null)
    const result = await cycleActions.approveCycle(cycleState.id)
    if (!result.ok) {
      setActionError(result.error ?? 'Failed to approve cycle')
      return
    }
    await cycle.refetch()
  }

  const handleCycleDefer = async (cycleState: { id: string }) => {
    setActionError(null)
    const result = await cycleActions.deferCycle(cycleState.id)
    if (!result.ok) {
      setActionError(result.error ?? 'Failed to defer cycle')
      return
    }
    await cycle.refetch()
  }

  const handleCycleReject = async (cycleState: { id: string }) => {
    setActionError(null)
    const confirmed = window.confirm('Reject this cycle? This will mark it as rejected and cannot be undone.')
    if (!confirmed) return
    const result = await cycleActions.rejectCycle(cycleState.id)
    if (!result.ok) {
      setActionError(result.error ?? 'Failed to reject cycle')
      return
    }
    await cycle.refetch()
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
            qualityResult={qualityResult.data}
            qualityLoading={qualityResult.loading}
            cycleState={cycle.data}
            cycleResult={cycleResult.data}
            busy={statusUpdate.loading || createTask.loading || linkTarget.loading || qwenRunner.loading || reReview.loading || cycleActions.loading}
            onIgnore={() => void handleStatus(selected, 'ignored')}
            onWaitingInput={() => void handleStatus(selected, 'waiting_for_input')}
            onCreateTask={() => void handleCreateTask(selected)}
            onRunQwenReview={() => void handleRunQwenReview(selected)}
            onReReview={() => void handleReReview(selected)}
            onCycleApprove={() => cycle.data && void handleCycleApprove(cycle.data)}
            onCycleDefer={() => cycle.data && void handleCycleDefer(cycle.data)}
            onCycleReject={() => cycle.data && void handleCycleReject(cycle.data)}
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

function WorkItemDetail({ item, review, reviewLoading, qualityResult, qualityLoading, cycleState, cycleResult, busy, onIgnore, onWaitingInput, onCreateTask, onRunQwenReview, onReReview, onCycleApprove, onCycleDefer, onCycleReject }: {
  item: ListingWorkItem
  review: ListingQwenReview | null
  reviewLoading: boolean
  qualityResult: ListingReviewResult | null
  qualityLoading: boolean
  cycleState: ListingCycleState | null
  cycleResult: ListingReviewResult | null
  busy: boolean
  onIgnore: () => void
  onWaitingInput: () => void
  onCreateTask: () => void
  onRunQwenReview: () => void
  onReReview: () => void
  onCycleApprove: () => void
  onCycleDefer: () => void
  onCycleReject: () => void
}) {
  const qwenEligible = isQwenEligible(item)
  return (
    <article className="audit-detail">
      <div className="flex justify-between gap-3 mb-4">
        <div>
          <h3>{targetLabel(item)}</h3>
          <p className="text-xs text-muted">{item.platform ?? 'all platforms'} / {shopLabel(item.shop_code)} / {item.target_type}</p>
        </div>
        <div className="flex items-center gap-2">
          {cycleState && (
            <span className={`cycle-badge ${cycleTone(cycleState.cycle_status)}`}>
              {cycleState.cycle_status.replace(/_/g, ' ')}
            </span>
          )}
          <div className="audit-score">{Math.round(item.priority_score)}</div>
        </div>
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
        <button className="btn" disabled={busy || !item.listing_id} onClick={onReReview}>Re-review</button>
      </div>
      {!item.listing_id && <p className="text-xs text-muted mt-2">Re-review requires a linked listing.</p>}
      {!qwenEligible && <p className="text-xs text-muted mt-2">Qwen runs only for mapped Rakuten/Amazon/Mercari audit items.</p>}

      <QualityScoreBlock result={qualityResult} loading={qualityLoading} cycle={cycleState} cycleResult={cycleResult} />
      {cycleState && (cycleState.cycle_status === 'reviewed' || cycleState.cycle_status === 'improved') && (
        <CycleActionsBar
          cycle={cycleState}
          busy={busy}
          onApprove={onCycleApprove}
          onDefer={onCycleDefer}
          onReject={onCycleReject}
        />
      )}
      <IssueBlock title="Trace" rows={[
        ['Family', item.product_family_id],
        ['SPU', item.product_spu_id],
        ['Variant', item.variant_id],
        ['Listing', item.listing_id],
        ['Listing SKU', item.listing_sku_id],
        ['Snapshot', item.source_snapshot_hash ? `${item.source_snapshot_hash.slice(0, 12)} / v${item.source_snapshot_version}` : `v${item.source_snapshot_version}`],
      ]} />
      <JsonBlock title="Classification Reasons" value={item.classification_reasons} />
      <StructuredFindingsBlock findings={item.deterministic_findings} />
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

function QualityScoreBlock({ result, loading, cycle, cycleResult }: { result: ListingReviewResult | null; loading: boolean; cycle?: ListingCycleState | null; cycleResult?: ListingReviewResult | null }) {
  if (loading) {
    return (
      <section className="audit-issue-block">
        <h4>Quality Score</h4>
        <p className="text-sm text-muted">Loading scores...</p>
      </section>
    )
  }

  if (!result) {
    return (
      <section className="audit-issue-block">
        <h4>Quality Score</h4>
        <p className="text-sm text-muted">No quality review yet. Run a technical review to generate scores.</p>
      </section>
    )
  }

  const SCORE_DIMS: Array<[string, number | null, string]> = [
    ['Technical', result.technical_score, 'Image health & loading'],
    ['Image', result.image_score, 'Count, main image, quality'],
    ['Content', result.content_score, 'OCR text, title, description'],
    ['Compliance', result.compliance_score, 'Marketplace rules'],
    ['Conversion', result.conversion_score, 'Buyer conversion optimization'],
    ['Operational Risk', result.operational_risk_score, 'Risk factors'],
  ]

  return (
    <section className="audit-issue-block">
      <h4>Quality Score</h4>
      <div className="flex justify-between gap-3 mb-3">
        <div>
          <span className={`audit-priority ${priorityTone(scoreGrade(result.final_score))}`}>
            {result.final_score != null ? Math.round(result.final_score) : '-'}
          </span>
          <strong className="ml-2">{scoreGradeLabel(result.final_score)}</strong>
        </div>
        <div className="text-xs text-muted">
          v{result.scoring_version} / {result.review_completeness ?? 'partial'} / {result.confidence}
        </div>
      </div>

      <div className="score-grid">
        {SCORE_DIMS.map(([label, score, hint]) => (
          <div key={label} className="score-bar-row">
            <div className="flex justify-between text-xs mb-1">
              <span title={hint}>{label}</span>
              <span>{score != null ? Math.round(score) : '-'}</span>
            </div>
            <div className="score-bar-track">
              <div
                className={`score-bar-fill ${scoreTone(score)}`}
                style={{ width: `${score != null ? Math.max(0, Math.min(100, score)) : 0}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {cycle && cycle.baseline_score != null && cycle.latest_score != null && (
        <div className={`cycle-delta ${deltaTone(cycle.score_delta)}`}>
          <span className="cycle-delta-label">Before: {Math.round(cycle.baseline_score)}</span>
          <span className="cycle-delta-arrow">→</span>
          <span className="cycle-delta-value">After: {Math.round(cycle.latest_score)}</span>
          <span className="cycle-delta-badge">
            {cycle.score_delta != null && cycle.score_delta >= 0 ? '▲' : '▼'} {' '}
            {cycle.score_delta != null ? Math.abs(Math.round(cycle.score_delta)) : '-'}
          </span>
        </div>
      )}

      {cycle && (
        <div className="mt-2 text-xs">
          <span className="text-muted">Cycle: {cycle.cycle_status.replace(/_/g, ' ')}</span>
          {cycleResult && cycleResult.issues_json && (
            <span className="ml-3 text-muted">Remaining issues: {cycleResult.issues_json.length}</span>
          )}
          <span className="ml-3">
            {isPublishReady(cycle) ? (
              <span style={{ color: 'var(--color-success, green)' }}>Ready for publish: Yes</span>
            ) : (
              <span style={{ color: 'var(--color-warning, #b8860b)' }}>Ready for publish: No ({publishBlockReason(cycle)})</span>
            )}
          </span>
        </div>
      )}

      {result.recommendations_json && result.recommendations_json.length > 0 && (
        <div className="mt-3">
          <h5 className="text-sm mb-2">Recommendations</h5>
          {result.recommendations_json.map((rec, idx) => (
            <div key={idx} className="audit-recommendation mb-2">
              <span className={`audit-priority ${priorityTone(String(rec['priority'] ?? 'medium'))}`}>
                {String(rec['priority'] ?? 'medium')}
              </span>
              <strong>{String(rec['fix_type'] ?? 'review')}</strong>
              <p>{String(rec['reason'] ?? '')}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function scoreGrade(score: number | null): string {
  if (score == null) return 'low'
  if (score < 40) return 'critical'
  if (score < 60) return 'high'
  if (score < 80) return 'medium'
  return 'low'
}

function scoreGradeLabel(score: number | null): string {
  if (score == null) return 'No score'
  if (score < 40) return 'Critical'
  if (score < 60) return 'Needs Review'
  if (score < 80) return 'Fair'
  return 'Good'
}

function scoreTone(score: number | null): string {
  if (score == null) return ''
  if (score < 40) return 'fill-critical'
  if (score < 60) return 'fill-high'
  if (score < 80) return 'fill-medium'
  return 'fill-low'
}

function StructuredFindingsBlock({ findings }: { findings: Array<Record<string, unknown>> }) {
  if (!findings || findings.length === 0) {
    return (
      <section className="audit-issue-block">
        <h4>Findings</h4>
        <pre>{JSON.stringify(findings, null, 2)}</pre>
      </section>
    )
  }

  return (
    <section className="audit-issue-block">
      <h4>Findings ({findings.length})</h4>
      {findings.map((finding, idx) => (
        <div key={idx} className="finding-item mb-3 pb-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="flex justify-between mb-2">
            <span className={`audit-priority ${priorityTone(String(finding['severity'] ?? 'low'))}`}>
              {String(finding['severity'] ?? 'low')}
            </span>
            <span className="text-xs text-muted">
              {String(finding['type'] ?? 'unknown')} / {String(finding['source'] ?? 'unknown')} / confidence {Number(finding['confidence'] ?? 0).toFixed(1)}
            </span>
          </div>
          {finding['operator_note'] ? (
            <p className="text-sm mb-1"><strong>Note:</strong> {String(finding['operator_note'])}</p>
          ) : null}
          {finding['evidence'] ? (
            <p className="text-xs text-muted">{String(finding['evidence'])}</p>
          ) : null}
          {finding['affected_image_indexes'] && Array.isArray(finding['affected_image_indexes']) && (finding['affected_image_indexes'] as number[]).length > 0 ? (
            <p className="text-xs text-muted mt-1">Image{(finding['affected_image_indexes'] as number[]).length > 1 ? 's' : ''}: {(finding['affected_image_indexes'] as number[]).join(', ')}</p>
          ) : null}
        </div>
      ))}
    </section>
  )
}

function priorityTone(value: string) {
  if (value === 'critical' || value === 'high') return 'high'
  if (value === 'medium') return 'medium'
  return 'low'
}

function cycleTone(status: string) {
  if (status === 'approved' || status === 'published' || status === 'improved') return 'low'
  if (status === 'fix_needed' || status === 'rejected') return 'high'
  if (status === 'fix_in_progress' || status === 're_review_queued' || status === 'review_queued') return 'medium'
  return 'low'
}

function deltaTone(delta: number | null): string {
  if (delta == null) return ''
  if (delta >= 10) return 'delta-positive'
  if (delta >= 0) return 'delta-neutral'
  return 'delta-negative'
}

function isPublishReady(cycle: ListingCycleState): boolean {
  if (cycle.latest_score == null) return false
  if (cycle.latest_score < 70) return false
  if (cycle.cycle_status !== 'improved' && cycle.cycle_status !== 'approved') return false
  return true
}

function publishBlockReason(cycle: ListingCycleState): string {
  if (cycle.latest_score == null) return 'No score yet'
  if (cycle.latest_score < 70) return 'Score too low'
  if (cycle.cycle_status !== 'improved' && cycle.cycle_status !== 'approved') return 'Pending approval'
  return 'Unknown'
}

function CycleActionsBar({ cycle, busy, onApprove, onDefer, onReject }: {
  cycle: ListingCycleState
  busy: boolean
  onApprove: () => void
  onDefer: () => void
  onReject: () => void
}) {
  return (
    <section className="audit-issue-block">
      <h4>Cycle Actions</h4>
      <div className="flex gap-2">
        <button className="btn btn-primary" style={{ backgroundColor: 'var(--color-success, #2e7d32)' }} disabled={busy} onClick={onApprove}>
          Approve
        </button>
        <button className="btn" disabled={busy} onClick={onDefer}>
          Defer
        </button>
        <button className="btn" style={{ backgroundColor: 'var(--color-danger, #c62828)', color: '#fff' }} disabled={busy} onClick={onReject}>
          Reject
        </button>
      </div>
    </section>
  )
}

function isQwenEligible(item: ListingWorkItem) {
  const findingText = JSON.stringify([item.classification_reasons, item.deterministic_findings]).toLowerCase()
  return (
    item.workflow_type === 'audit_existing_listing'
    && (item.platform === 'rakuten' || item.platform === 'amazon' || item.platform === 'mercari')
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
