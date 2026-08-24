import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PlatformAccountMonthlyMetric } from '@lib/account-metrics-types'
import { useAccountMetrics } from '../hooks/useAccountMetrics'
import {
  aggregateCompleteAccountMetrics,
  buildManagementSignals,
  completePeriods,
  latestCompleteComparison,
  metricChange,
  type ManagementSignal,
  type MetricKey,
} from '../lib/accountMetrics'

const COMBINED_MERCARI_ACCOUNT_ID = 'mercari-combined'

const METRIC_OPTIONS: Array<{ key: MetricKey; label: string }> = [
  { key: 'sales_amount', label: 'Sales' },
  { key: 'visitor_count', label: 'Visitors' },
  { key: 'estimated_conversion_rate', label: 'Estimated CVR' },
  { key: 'average_purchase_value', label: 'Purchase value' },
  { key: 'new_follower_count', label: 'New followers' },
]

function currency(value: number, code = 'JPY'): string {
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: code,
    maximumFractionDigits: 0,
  }).format(value)
}

function integer(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
}

function percent(value: number | null, digits = 2): string {
  return value === null ? '—' : `${(value * 100).toFixed(digits)}%`
}

function changeLabel(value: number | null): string {
  if (value === null) return 'No comparison'
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}% MoM`
}

function monthLabel(periodStart: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${periodStart}T00:00:00Z`))
}

function metricNumber(row: PlatformAccountMonthlyMetric, key: MetricKey): number | null {
  const result = row[key]
  return typeof result === 'number' ? result : null
}

function metricDisplay(row: PlatformAccountMonthlyMetric, key: MetricKey): string {
  const value = metricNumber(row, key)
  if (value === null) return '—'
  if (key === 'sales_amount' || key === 'average_purchase_value') return currency(value, row.currency)
  if (key === 'estimated_conversion_rate') return percent(value, 2)
  return integer(value)
}

function TrendChart({ rows, metric }: { rows: PlatformAccountMonthlyMetric[]; metric: MetricKey }) {
  const points = completePeriods(rows)
    .map((row) => ({ row, value: metricNumber(row, metric) }))
    .filter((point): point is { row: PlatformAccountMonthlyMetric; value: number } => point.value !== null)
  if (points.length < 2) return <p className="text-muted">At least two complete periods are needed for a chart.</p>

  const width = 760
  const height = 250
  const padX = 44
  const padY = 28
  const values = points.map((point) => point.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const coordinates = points.map((point, index) => ({
    ...point,
    x: padX + (index / (points.length - 1)) * (width - padX * 2),
    y: padY + ((max - point.value) / range) * (height - padY * 2),
  }))
  const path = coordinates.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')

  return (
    <svg className="metrics-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${metric} monthly trend`}>
      <line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} className="metrics-chart-axis" />
      <path d={path} className="metrics-chart-line" />
      {coordinates.map((point) => (
        <g key={point.row.id}>
          <circle cx={point.x} cy={point.y} r="4" className="metrics-chart-point" />
          <text x={point.x} y={height - 7} textAnchor="middle" className="metrics-chart-label">
            {point.row.period_start.slice(2, 7)}
          </text>
          <title>{`${monthLabel(point.row.period_start)}: ${metricDisplay(point.row, metric)}`}</title>
        </g>
      ))}
    </svg>
  )
}

function planningParams(
  signal: ManagementSignal,
  account: { id: string; platform: string; shop_code: string },
  period: string,
) {
  const evidence = `${signal.evidence}\n\nRecommended review: ${signal.recommendation}`
  const task = new URLSearchParams({
    title: `${account.shop_code}: ${signal.title}`,
    description: evidence,
    task_type: 'account',
    priority: signal.severity === 'high' ? 'high' : 'medium',
    platform: account.platform,
    shop_code: account.shop_code,
    source: 'manual',
    execution_brief: 'Review the evidence, define a measurable action, assign an owner and due date, then submit manually. Do not change marketplace settings automatically.',
    target_type: 'account_metric',
    target_id: `${account.id}:${period}:${signal.key}`,
    target_label: `${account.platform}/${account.shop_code} ${period}`,
  })
  const project = new URLSearchParams({
    name: `${account.shop_code} — ${signal.title}`,
    description: `Objective\n${signal.recommendation}\n\nBaseline evidence\n${signal.evidence}\n\nPlanning checklist\n1. Confirm the metric and affected listings.\n2. Define owner, scope, target, and review date.\n3. Create bounded tasks.\n4. Measure the next complete monthly period.`,
    source: 'account_metrics',
    platform: account.platform,
    shop_code: account.shop_code,
    period,
    signal: signal.key,
  })
  return { task, project }
}

export default function AccountMetrics() {
  const [selectedAccountId, setSelectedAccountId] = useState(COMBINED_MERCARI_ACCOUNT_ID)
  const [chartMetric, setChartMetric] = useState<MetricKey>('sales_amount')
  const { data, loading, error, refetch } = useAccountMetrics()

  useEffect(() => {
    if (data.accounts.length === 0) return
    if (selectedAccountId === COMBINED_MERCARI_ACCOUNT_ID) return
    if (data.accounts.some((account) => account.id === selectedAccountId)) return
    setSelectedAccountId(COMBINED_MERCARI_ACCOUNT_ID)
  }, [data.accounts, selectedAccountId])

  const mercariAccounts = useMemo(
    () => data.accounts.filter((account) => account.platform === 'mercari'),
    [data.accounts],
  )
  const combinedRows = useMemo(
    () => aggregateCompleteAccountMetrics(
      data.metrics,
      mercariAccounts.map((account) => account.id),
      COMBINED_MERCARI_ACCOUNT_ID,
    ),
    [data.metrics, mercariAccounts],
  )
  const combinedSelected = selectedAccountId === COMBINED_MERCARI_ACCOUNT_ID
  const selectedAccount = combinedSelected
    ? { id: COMBINED_MERCARI_ACCOUNT_ID, platform: 'mercari', shop_code: 'all-mercari-shops' }
    : data.accounts.find((account) => account.id === selectedAccountId) ?? null
  const rows = useMemo(
    () => combinedSelected
      ? combinedRows
      : data.metrics.filter((row) => row.platform_account_id === selectedAccountId),
    [combinedRows, combinedSelected, data.metrics, selectedAccountId],
  )
  const { latest, previous } = latestCompleteComparison(rows)
  const signals = buildManagementSignals(rows)
  const partial = combinedSelected ? null : [...rows].reverse().find((row) => row.coverage_status === 'partial') ?? null

  return (
    <div className="metrics-page">
      <div className="page-header metrics-page-header">
        <div>
          <p className="metrics-eyebrow">BUSINESS PERFORMANCE</p>
          <h2>Account Metrics</h2>
          <p className="text-muted">Review trends, decide what matters, then plan work manually.</p>
        </div>
        <button className="btn" type="button" onClick={() => void refetch()} disabled={loading}>Refresh</button>
      </div>

      {error && <p className="metrics-error">{error}</p>}
      {loading && <p className="text-muted">Loading account metrics...</p>}

      {!loading && data.accounts.length > 0 && (
        <>
          <section className="metrics-toolbar card">
            <div className="form-group">
              <label>Marketplace account</label>
              <select value={selectedAccountId} onChange={(event) => setSelectedAccountId(event.target.value)}>
                <option value={COMBINED_MERCARI_ACCOUNT_ID}>All Mercari Shops · combined</option>
                {data.accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.display_name || account.shop_code} · {account.platform}
                  </option>
                ))}
              </select>
            </div>
            <div className="metrics-period-note">
              <span>Latest complete period</span>
              <strong>{latest ? monthLabel(latest.period_start) : '—'}</strong>
            </div>
            {combinedSelected && (
              <div className="metrics-period-note">
                <span>Combined coverage</span>
                <strong>{mercariAccounts.length} shops · strict complete-month overlap</strong>
              </div>
            )}
            {partial && (
              <div className="metrics-period-note partial">
                <span>Partial period available</span>
                <strong>{monthLabel(partial.period_start)} · as of {partial.source_as_of_date ?? 'unknown'}</strong>
              </div>
            )}
          </section>

          {latest && (
            <section className="metrics-kpi-grid">
              {METRIC_OPTIONS.map((option) => (
                <button key={option.key} className={`metrics-kpi card ${chartMetric === option.key ? 'selected' : ''}`} type="button" onClick={() => setChartMetric(option.key)}>
                  <span>{option.label}</span>
                  <strong>{metricDisplay(latest, option.key)}</strong>
                  <small className={(metricChange(latest, previous, option.key) ?? 0) < 0 ? 'negative' : 'positive'}>
                    {changeLabel(metricChange(latest, previous, option.key))}
                  </small>
                </button>
              ))}
            </section>
          )}

          <section className="card metrics-trend-card">
            <div className="flex justify-between items-center gap-3">
              <div>
                <h3>{METRIC_OPTIONS.find((option) => option.key === chartMetric)?.label} trend</h3>
                <p className="text-muted text-sm">{combinedSelected ? 'Months with valid complete data for every Mercari shop only.' : 'Complete months only.'} Click a KPI card to change the chart.</p>
              </div>
            </div>
            <TrendChart rows={rows} metric={chartMetric} />
          </section>

          {selectedAccount && latest && (
            <section>
              <div className="metrics-section-heading">
                <div>
                  <p className="metrics-eyebrow">MANAGER REVIEW</p>
                  <h3>Signals and planning actions</h3>
                </div>
                <p className="text-muted text-sm">Recommendations are deterministic prompts, not automatic decisions.</p>
              </div>
              <div className="metrics-signal-grid">
                {signals.map((signal) => {
                  const links = planningParams(signal, selectedAccount, latest.period_start.slice(0, 7))
                  return (
                    <article key={signal.key} className={`card metrics-signal ${signal.severity}`}>
                      <span className="metrics-signal-badge">{signal.severity}</span>
                      <h4>{signal.title}</h4>
                      <p>{signal.evidence}</p>
                      <p className="text-muted">{signal.recommendation}</p>
                      <div className="flex gap-2">
                        <Link className="btn btn-primary btn-sm" to={`/tasks/new?${links.task.toString()}`}>Plan task</Link>
                        <Link className="btn btn-sm" to={`/projects/new?${links.project.toString()}`}>Start project</Link>
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          )}

          <section className="card metrics-table-card">
            <h3>{combinedSelected ? 'Combined monthly history' : 'Monthly history'}</h3>
            <div className="metrics-table-wrap">
              <table className="metrics-table">
                <thead>
                  <tr>
                    <th>Month</th><th>Coverage</th><th>Sales</th><th>Visitors</th><th>Est. purchasers</th><th>Est. CVR</th><th>Purchase value</th><th>New followers</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows].reverse().map((row) => (
                    <tr key={row.id}>
                      <td>{monthLabel(row.period_start)}</td>
                      <td><span className={`metrics-coverage ${row.coverage_status}`}>{row.coverage_status}</span></td>
                      <td>{currency(row.sales_amount, row.currency)}</td>
                      <td>{integer(row.visitor_count)}</td>
                      <td>{row.estimated_purchaser_count === null ? '—' : integer(row.estimated_purchaser_count)}</td>
                      <td>{percent(row.estimated_conversion_rate)}</td>
                      <td>{currency(row.average_purchase_value, row.currency)}</td>
                      <td>{integer(row.new_follower_count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
