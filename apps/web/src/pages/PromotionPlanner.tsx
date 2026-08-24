import { useMemo, useState } from 'react'
import {
  apiOperationForStatus, buildFiveZeroCouponPlan, buildRakutenCouponPayload, EMPTY_RAKUTEN_COUPON_FORM,
  FIVE_ZERO_TEMPLATE, fiveZeroOccurrences, formFromRakutenPlan, splitItemUrls, updateModeForCoupon, validateRakutenCouponForm,
  type RakutenCouponForm, type RakutenCouponPlan, type RakutenCouponWorkflowStatus,
  type RakutenDiscountType, type RakutenItemType, type RakutenRankCode,
} from './rakuten-coupon-model'

const STORAGE_KEY = 'rpagentos.rakuten-coupon-plans.v2'
const AUGUST_REVIEW_OCCURRENCES = fiveZeroOccurrences(2026, 8)
const AUGUST_25_REVIEW_PLAN = buildFiveZeroCouponPlan('2026-08-25', 'publish_review', '2026-08-24T09:00:00+09:00')
const STATUS_LABELS: Record<RakutenCouponWorkflowStatus, string> = {
  draft: 'Draft', publish_review: 'Publish review', published: 'Published',
  cancellation_review: 'Cancellation review', cancelled: 'Cancelled',
}
const RANKS: Array<{ code: RakutenRankCode; label: string }> = [
  { code: 0, label: 'No restriction' }, { code: 1, label: 'Regular' },
  { code: 2, label: 'Silver' }, { code: 3, label: 'Gold' },
  { code: 4, label: 'Platinum' }, { code: 5, label: 'Diamond' },
]

function loadPlans(): RakutenCouponPlan[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]')
    const stored = Array.isArray(parsed) ? parsed.filter((plan): plan is RakutenCouponPlan =>
      typeof plan === 'object' && plan !== null && typeof (plan as RakutenCouponPlan).id === 'string') : []
    const merged = stored.some(plan => plan.id === AUGUST_25_REVIEW_PLAN.id) ? stored : [AUGUST_25_REVIEW_PLAN, ...stored]
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
    return merged
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([AUGUST_25_REVIEW_PLAN]))
    return [AUGUST_25_REVIEW_PLAN]
  }
}

function cloneEmptyForm(): RakutenCouponForm {
  return { ...EMPTY_RAKUTEN_COUPON_FORM, multiRankCond: [...EMPTY_RAKUTEN_COUPON_FORM.multiRankCond] }
}

function discountLabel(plan: RakutenCouponPlan): string {
  if (plan.coupon.discountType === 4) return 'Free shipping'
  return plan.coupon.discountType === 2 ? `${plan.coupon.discountFactor}% off` : `¥${plan.coupon.discountFactor.toLocaleString()} off`
}

function itemTypeLabel(type: RakutenItemType): string {
  return ({ 1: 'Single item', 3: 'Multiple items', 4: 'Entire order', 5: 'Free shipping' } as const)[type]
}

function formatSchedule(value: string): string {
  return value.replace(':00+09:00', ' JST').replace('+09:00', ' JST').replace('T', ' ')
}

function downloadJson(filename: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function PromotionPlanner() {
  const [plans, setPlans] = useState<RakutenCouponPlan[]>(loadPlans)
  const [form, setForm] = useState<RakutenCouponForm>(cloneEmptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [composerOpen, setComposerOpen] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [statusFilter, setStatusFilter] = useState<'all' | RakutenCouponWorkflowStatus>('all')
  const filteredPlans = useMemo(() => plans.filter(plan => statusFilter === 'all' || plan.status === statusFilter), [plans, statusFilter])

  const persist = (next: RakutenCouponPlan[]) => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    setPlans(next)
  }
  const openNew = () => { setForm(cloneEmptyForm()); setEditingId(null); setErrors([]); setComposerOpen(true) }
  const openEdit = (plan: RakutenCouponPlan) => { setForm(formFromRakutenPlan(plan)); setEditingId(plan.id); setErrors([]); setComposerOpen(true) }

  const savePlan = (status: 'draft' | 'publish_review') => {
    const validationErrors = validateRakutenCouponForm(form)
    if (validationErrors.length) { setErrors(validationErrors); return }
    const now = new Date().toISOString()
    const existing = editingId ? plans.find(plan => plan.id === editingId) : undefined
    const next: RakutenCouponPlan = {
      id: existing?.id ?? crypto.randomUUID(), status, internalName: form.internalName.trim(),
      shopCode: form.shopCode.trim(), coupon: buildRakutenCouponPayload(form),
      couponCode: existing?.couponCode, pcGetUrl: existing?.pcGetUrl,
      calendarGeneration: existing?.calendarGeneration,
      notes: form.notes.trim(), createdAt: existing?.createdAt ?? now, updatedAt: now,
    }
    persist(existing ? plans.map(plan => plan.id === next.id ? next : plan) : [next, ...plans])
    setComposerOpen(false); setEditingId(null); setErrors([])
  }

  const duplicatePlan = (plan: RakutenCouponPlan) => {
    const now = new Date().toISOString()
    persist([{ ...plan, id: crypto.randomUUID(), internalName: `${plan.internalName} (copy)`, status: 'draft', couponCode: undefined, pcGetUrl: undefined, calendarGeneration: undefined, createdAt: now, updatedAt: now }, ...plans])
  }

  const generateCalendarDraft = (occurrenceDate: string) => {
    const candidate = buildFiveZeroCouponPlan(occurrenceDate)
    const existing = plans.find(plan => plan.id === candidate.id)
    if (existing) { openEdit(existing); return }
    persist([candidate, ...plans])
    openEdit(candidate)
  }

  const setDiscountType = (discountType: RakutenDiscountType) => setForm(current => ({
    ...current, discountType, itemType: discountType === 4 ? 5 : current.itemType === 5 ? 4 : current.itemType,
    discountFactor: discountType === 4 ? '1' : current.discountFactor,
  }))
  const setItemType = (itemType: RakutenItemType) => setForm(current => ({
    ...current, itemType, discountType: itemType === 5 ? 4 : current.discountType === 4 ? 2 : current.discountType,
    discountFactor: itemType === 5 ? '1' : current.discountFactor,
  }))
  const toggleRank = (code: RakutenRankCode) => setForm(current => {
    if (code === 0) return { ...current, multiRankCond: [0] }
    const ranks = current.multiRankCond.filter(rank => rank !== 0)
    const next = ranks.includes(code) ? ranks.filter(rank => rank !== code) : [...ranks, code]
    return { ...current, multiRankCond: next.length ? next : [0] }
  })

  const workflowSteps = [
    ['Draft', 'No API call', 'Editable internal plan'],
    ['Publish review', 'Approval gate', 'Review exact coupon.issue payload'],
    ['Published', 'coupon.issue → coupon.get', 'Store couponCode and verify'],
    ['Update', 'coupon.update / coupon.patch', 'Full update before cutoff; displayFlag patch afterwards'],
    ['Cancellation', 'coupon.delete → coupon.get', 'Delete then verify the result'],
  ]

  return <div className="promotion-page">
    <div className="page-header promotion-header"><div><p className="promotion-eyebrow">Commerce operations · Rakuten RMS</p><h2>Promotion Planner</h2><p className="text-sm text-muted">Rakuten CouponAPI-native planning and approval workflow.</p></div><button className="btn btn-primary" onClick={openNew}>+ New Rakuten coupon</button></div>
    <div className="promotion-notice" role="status"><span className="promotion-notice-icon">◎</span><div><strong>Planning mode — no API execution</strong><p>Draft and review states are internal. No issue, update, patch, or delete request is sent from this page.</p></div></div>

    <section className="promotion-type-grid" aria-label="Promotion types">
      <button className="promotion-type-card active" onClick={openNew}><span>Rakuten Coupon</span><small>CouponAPI field contract enabled</small><em>Available now</em></button>
      <button className="promotion-type-card" disabled><span>Amazon Coupon</span><small>Separate Amazon-native definition</small><em>Next step</em></button>
      <button className="promotion-type-card" disabled><span>Time sale</span><small>Scheduled price promotion</small><em>Coming later</em></button>
      <button className="promotion-type-card" disabled><span>Ads / Campaign</span><small>Budget and campaign planning</small><em>Coming later</em></button>
    </section>

    <section className="promotion-calendar card" aria-labelledby="promotion-calendar-title">
      <div className="promotion-list-heading"><div><p className="promotion-eyebrow">Calendar-driven templates</p><h3 id="promotion-calendar-title">5と0のつく日 · August 2026</h3><p className="text-sm text-muted">System prepares drafts; an operator reviews and triggers RMS creation.</p></div><a className="btn btn-sm" href="https://event.rakuten.co.jp/card/pointday/" target="_blank" rel="noreferrer">Official campaign page ↗</a></div>
      <div className="promotion-template-summary">
        <div><span className="promotion-template-version">Template v{FIVE_ZERO_TEMPLATE.version}</span><strong>{FIVE_ZERO_TEMPLATE.name}</strong><small>{FIVE_ZERO_TEMPLATE.discountLabel}</small></div>
        <ul>{FIVE_ZERO_TEMPLATE.guardrails.map(guardrail => <li key={guardrail}>{guardrail}</li>)}</ul>
      </div>
      <div className="promotion-occurrence-grid">{AUGUST_REVIEW_OCCURRENCES.map(occurrence => {
        const plan = plans.find(value => value.calendarGeneration?.occurrenceDate === occurrence.date && value.calendarGeneration.templateId === FIVE_ZERO_TEMPLATE.id)
        const isReviewTarget = occurrence.date === '2026-08-25'
        return <article className={`promotion-occurrence ${isReviewTarget ? 'review-target' : ''}`} key={occurrence.date}>
          <span>Aug</span><strong>{occurrence.day}</strong><small>{plan ? STATUS_LABELS[plan.status] : 'Available'}</small>
          <button className={`btn btn-sm ${isReviewTarget ? 'btn-primary' : ''}`} onClick={() => generateCalendarDraft(occurrence.date)}>{plan ? 'Review plan' : 'Generate draft'}</button>
        </article>
      })}</div>
      <p className="promotion-calendar-footnote"><strong>Aug 25 review draft is ready.</strong> The 5% discount, 100 issue limit, wording, margin and official event timing must be confirmed before any <code>coupon.issue</code> action.</p>
    </section>

    <section className="promotion-workflow card">
      <div className="promotion-list-heading"><div><h3>Rakuten coupon lifecycle</h3><p className="text-sm text-muted">Internal approval states stay separate from RMS API state.</p></div></div>
      <div className="promotion-workflow-grid">{workflowSteps.map(([label, operation, description], index) => <div className="promotion-workflow-step" key={label}><span>{index + 1}</span><strong>{label}</strong><code>{operation}</code><small>{description}</small></div>)}</div>
    </section>

    <div className="promotion-list-heading"><div><h3>Rakuten coupon plans</h3><p className="text-sm text-muted">{plans.length} saved in this browser</p></div><div className="promotion-filters">{(['all', 'draft', 'publish_review', 'published', 'cancellation_review', 'cancelled'] as const).map(filter => <button key={filter} className={`btn btn-sm ${statusFilter === filter ? 'btn-primary' : ''}`} onClick={() => setStatusFilter(filter)}>{filter === 'all' ? 'All' : STATUS_LABELS[filter]}</button>)}</div></div>

    {filteredPlans.length === 0 ? <div className="promotion-empty"><div className="promotion-empty-mark">%</div><h3>{plans.length ? 'No coupons in this state' : 'Plan your first Rakuten coupon'}</h3><p>Build a payload that maps directly to coupon.issue, then submit it for approval.</p>{!plans.length && <button className="btn btn-primary" onClick={openNew}>Create Rakuten coupon draft</button>}</div> :
      <div className="promotion-plan-grid">{filteredPlans.map(plan => <article className="promotion-plan-card" key={plan.id}>
        <div className="promotion-plan-topline"><span className={`promotion-status ${plan.status}`}>{STATUS_LABELS[plan.status]}</span><span className="promotion-discount">{discountLabel(plan)}</span></div>
        <h3>{plan.internalName}</h3><p className="promotion-customer-title">{plan.coupon.couponName} · {plan.coupon.couponCaption}</p>
        <div className="promotion-platform-pills"><span className="promotion-platform rakuten">Rakuten · {plan.shopCode}</span>{plan.calendarGeneration && <span className="promotion-platform calendar">System · {plan.calendarGeneration.templateId} v{plan.calendarGeneration.templateVersion}</span>}<code>{apiOperationForStatus(plan.status)}</code></div>
        <dl className="promotion-plan-details"><div><dt>Starts</dt><dd>{formatSchedule(plan.coupon.couponStartDate)}</dd></div><div><dt>Ends</dt><dd>{formatSchedule(plan.coupon.couponEndDate)}</dd></div><div><dt>itemType</dt><dd>{plan.coupon.itemType} · {itemTypeLabel(plan.coupon.itemType)}</dd></div><div><dt>issueCount</dt><dd>{plan.coupon.issueCount.toLocaleString()}</dd></div>{plan.couponCode && <div><dt>couponCode</dt><dd>{plan.couponCode}</dd></div>}{plan.status === 'published' && <div><dt>Update mode</dt><dd>{updateModeForCoupon(plan)}</dd></div>}</dl>
        <div className="promotion-card-actions">{(plan.status === 'draft' || plan.status === 'publish_review') && <button className="btn btn-sm" onClick={() => openEdit(plan)}>Edit</button>}<button className="btn btn-sm" onClick={() => duplicatePlan(plan)}>Duplicate</button><button className="btn btn-sm" onClick={() => downloadJson(`rakuten-coupon-issue-${plan.id}.json`, plan.coupon)}>Export coupon.issue JSON</button></div>
      </article>)}</div>}

    {composerOpen && <div className="promotion-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setComposerOpen(false) }}><section className="promotion-composer" role="dialog" aria-modal="true" aria-labelledby="promotion-composer-title">
      <div className="promotion-composer-header"><div><p className="promotion-eyebrow">Rakuten · coupon.issue</p><h2 id="promotion-composer-title">{editingId ? 'Edit coupon draft' : 'Create coupon draft'}</h2></div><button className="promotion-close" onClick={() => setComposerOpen(false)} aria-label="Close">×</button></div>

      <div className="promotion-form-section"><div className="promotion-section-title"><span>1</span><div><h3>Planning identity</h3><p>Internal metadata; not sent to CouponAPI.</p></div></div><div className="form-row"><div className="form-group"><label htmlFor="internal-name">Internal plan name *</label><input id="internal-name" value={form.internalName} onChange={e => setForm({ ...form, internalName: e.target.value })} placeholder="e.g. September inventory push" /></div><div className="form-group"><label htmlFor="shop-code">Rakuten shop code *</label><input id="shop-code" value={form.shopCode} onChange={e => setForm({ ...form, shopCode: e.target.value })} /></div></div></div>

      <div className="promotion-form-section"><div className="promotion-section-title"><span>2</span><div><h3>Coupon definition</h3><p>Names and limits match CouponToIssue.</p></div></div><div className="form-row"><div className="form-group"><label htmlFor="coupon-name"><code>couponName</code> * · max 50</label><input id="coupon-name" maxLength={50} value={form.couponName} onChange={e => setForm({ ...form, couponName: e.target.value })} placeholder="サマーセール10%OFF" /><small>{Array.from(form.couponName).length}/50</small></div><div className="form-group"><label htmlFor="coupon-caption"><code>couponCaption</code> * · max 30</label><input id="coupon-caption" maxLength={30} value={form.couponCaption} onChange={e => setForm({ ...form, couponCaption: e.target.value })} placeholder="全品10%割引" /><small>{Array.from(form.couponCaption).length}/30</small></div></div><div className="form-group"><label htmlFor="coupon-image"><code>couponImage</code> · optional URL</label><input id="coupon-image" type="url" value={form.couponImage} onChange={e => setForm({ ...form, couponImage: e.target.value })} placeholder="https://..." /></div></div>

      <div className="promotion-form-section"><div className="promotion-section-title"><span>3</span><div><h3>Schedule and inventory</h3><p>Exported timestamps include +09:00.</p></div></div><div className="promotion-field-grid four"><div className="form-group"><label htmlFor="start-at"><code>couponStartDate</code> *</label><input id="start-at" type="datetime-local" step="1" value={form.couponStartDate} onChange={e => setForm({ ...form, couponStartDate: e.target.value })} /></div><div className="form-group"><label htmlFor="end-at"><code>couponEndDate</code> *</label><input id="end-at" type="datetime-local" step="1" value={form.couponEndDate} onChange={e => setForm({ ...form, couponEndDate: e.target.value })} /></div><div className="form-group"><label htmlFor="issue-count"><code>issueCount</code> *</label><input id="issue-count" type="number" min="1" value={form.issueCount} onChange={e => setForm({ ...form, issueCount: e.target.value })} /></div><div className="form-group"><label htmlFor="member-max"><code>memberAvailMaxCount</code> *</label><input id="member-max" type="number" min="1" value={form.memberAvailMaxCount} onChange={e => setForm({ ...form, memberAvailMaxCount: e.target.value })} /></div></div></div>

      <div className="promotion-form-section"><div className="promotion-section-title"><span>4</span><div><h3>Discount and target</h3><p>Numeric values follow Rakuten enums.</p></div></div><div className="promotion-field-grid three"><div className="form-group"><label htmlFor="item-type"><code>itemType</code></label><select id="item-type" value={form.itemType} onChange={e => setItemType(Number(e.target.value) as RakutenItemType)}><option value={1}>1 · Single item</option><option value={3}>3 · Multiple items</option><option value={4}>4 · Entire order</option><option value={5}>5 · Free shipping</option></select></div><div className="form-group"><label htmlFor="discount-type"><code>discountType</code></label><select id="discount-type" value={form.discountType} onChange={e => setDiscountType(Number(e.target.value) as RakutenDiscountType)}><option value={1}>1 · Fixed yen</option><option value={2}>2 · Percentage</option><option value={4}>4 · Free shipping</option></select></div><div className="form-group"><label htmlFor="discount-factor"><code>discountFactor</code></label><input id="discount-factor" type="number" min="0" max={form.discountType === 2 ? 99 : undefined} disabled={form.discountType === 4} value={form.discountFactor} onChange={e => setForm({ ...form, discountFactor: e.target.value })} /></div></div>
        {(form.itemType === 1 || form.itemType === 3) && <div className="form-group"><label htmlFor="item-urls"><code>items[].itemUrl</code> * · max 3000</label><textarea id="item-urls" value={form.itemUrls} onChange={e => setForm({ ...form, itemUrls: e.target.value })} placeholder="https://item.rakuten.co.jp/homebliss/item-code/" /><small>{splitItemUrls(form.itemUrls).length} item URLs</small></div>}
        <div className="form-row"><div className="form-group"><label htmlFor="combine-flag"><code>combineFlag</code></label><select id="combine-flag" value={form.combineFlag} onChange={e => setForm({ ...form, combineFlag: Number(e.target.value) as 0 | 1 })}><option value={0}>0 · Cannot combine</option><option value={1}>1 · Can combine</option></select></div><div className="form-group"><label htmlFor="display-flag"><code>displayFlag</code></label><select id="display-flag" value={form.displayFlag} onChange={e => setForm({ ...form, displayFlag: Number(e.target.value) as 0 | 1 })}><option value={0}>0 · Hidden</option><option value={1}>1 · Visible</option></select></div></div>
      </div>

      <div className="promotion-form-section"><div className="promotion-section-title"><span>5</span><div><h3>Optional conditions</h3><p>Mapped to otherConditions and multiRankCond.</p></div></div><div className="promotion-field-grid three"><div className="form-group"><label htmlFor="device"><code>RS001</code> device</label><select id="device" value={form.deviceCondition} onChange={e => setForm({ ...form, deviceCondition: e.target.value as '' | '0' | '1' })}><option value="">Automatic / unspecified</option><option value="0">0 · PC</option><option value="1">1 · Mobile</option></select></div><div className="form-group"><label htmlFor="minimum-spend"><code>RS003</code> minimum spend (¥)</label><input id="minimum-spend" type="number" min="1" max="999999999" value={form.minimumSpend} onChange={e => setForm({ ...form, minimumSpend: e.target.value })} /></div><div className="form-group"><label htmlFor="minimum-quantity"><code>RS004</code> minimum quantity</label><input id="minimum-quantity" type="number" min="0" max="999999999" value={form.minimumQuantity} onChange={e => setForm({ ...form, minimumQuantity: e.target.value })} /></div></div>
        <fieldset className="promotion-rank-fieldset"><legend><code>multiRankCond</code></legend><div className="promotion-rank-options">{RANKS.map(rank => <label key={rank.code}><input type="checkbox" checked={form.multiRankCond.includes(rank.code)} onChange={() => toggleRank(rank.code)} />{rank.code} · {rank.label}</label>)}</div></fieldset>
        <div className="form-group"><label htmlFor="notes">Internal notes · not sent to API</label><textarea id="notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Business goal, margin guardrail, approval context" /></div>
      </div>

      {errors.length > 0 && <div className="promotion-errors" role="alert"><strong>CouponAPI validation:</strong><ul>{errors.map(error => <li key={error}>{error}</li>)}</ul></div>}
      <div className="promotion-composer-footer"><p><strong>No marketplace execution.</strong> Publish review exports coupon.issue DTO; it does not call Rakuten.</p><div><button className="btn" onClick={() => setComposerOpen(false)}>Cancel</button><button className="btn" onClick={() => savePlan('draft')}>Save draft</button><button className="btn btn-primary" onClick={() => savePlan('publish_review')}>Submit for publish review</button></div></div>
    </section></div>}
  </div>
}
