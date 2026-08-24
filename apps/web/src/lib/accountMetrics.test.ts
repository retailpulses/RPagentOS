import assert from 'node:assert/strict'
import test from 'node:test'
import type { PlatformAccountMonthlyMetric } from '../../../../src/lib/account-metrics-types.js'
import { aggregateCompleteAccountMetrics, buildManagementSignals, latestCompleteComparison } from './accountMetrics.js'

function metric(
  period: string,
  overrides: Partial<PlatformAccountMonthlyMetric> = {},
): PlatformAccountMonthlyMetric {
  return {
    id: period,
    platform_account_id: 'account-1',
    period_start: `${period}-01`,
    period_end: `${period}-28`,
    source_as_of_date: null,
    coverage_status: 'complete',
    currency: 'JPY',
    sales_amount: 100_000,
    visitor_count: 10_000,
    reported_conversion_rate: null,
    reported_conversion_rate_reliable: false,
    average_purchase_value: 10_000,
    new_follower_count: 100,
    estimated_purchaser_count: 10,
    estimated_conversion_rate: 0.001,
    quality_flags: [],
    ...overrides,
  }
}

test('uses only complete periods for the latest comparison', () => {
  const comparison = latestCompleteComparison([
    metric('2026-06'),
    metric('2026-07'),
    metric('2026-08', { coverage_status: 'partial' }),
  ])

  assert.equal(comparison.latest?.period_start, '2026-07-01')
  assert.equal(comparison.previous?.period_start, '2026-06-01')
})

test('returns an insufficient-history prompt with fewer than two complete periods', () => {
  const signals = buildManagementSignals([metric('2026-07')])
  assert.deepEqual(signals.map((signal) => signal.key), ['insufficient-history'])
})

test('flags material traffic decline and escalates a severe drop', () => {
  const signals = buildManagementSignals([
    metric('2026-06'),
    metric('2026-07', { visitor_count: 6_000, sales_amount: 65_000 }),
  ])

  assert.equal(signals[0]?.key, 'traffic-decline')
  assert.equal(signals[0]?.severity, 'high')
})

test('flags conversion decline when traffic remains stable', () => {
  const signals = buildManagementSignals([
    metric('2026-06'),
    metric('2026-07', { visitor_count: 10_500, estimated_conversion_rate: 0.0007 }),
  ])

  assert.ok(signals.some((signal) => signal.key === 'conversion-decline'))
  assert.ok(!signals.some((signal) => signal.key === 'traffic-decline'))
})

test('offers a bounded growth experiment when no decline threshold is crossed', () => {
  const signals = buildManagementSignals([
    metric('2026-06'),
    metric('2026-07', { sales_amount: 105_000, visitor_count: 10_100 }),
  ])

  assert.deepEqual(signals.map((signal) => signal.key), ['growth-opportunity'])
})

test('combines a period only when every account has one valid complete metric', () => {
  const accountIds = ['shop1', 'shop2', 'shop3', 'shop4']
  const rows = accountIds.map((accountId, index) => metric('2026-07', {
    id: `${accountId}:2026-07`,
    platform_account_id: accountId,
    sales_amount: 100_000 + index * 10_000,
    visitor_count: 10_000 + index * 1_000,
    estimated_purchaser_count: 20 + index,
    new_follower_count: 100 + index * 10,
  }))

  const [combined] = aggregateCompleteAccountMetrics(rows, accountIds)
  assert.equal(combined.sales_amount, 460_000)
  assert.equal(combined.visitor_count, 46_000)
  assert.equal(combined.estimated_purchaser_count, 86)
  assert.equal(combined.new_follower_count, 460)
  assert.equal(combined.estimated_conversion_rate, 86 / 46_000)
  assert.equal(combined.average_purchase_value, 460_000 / 86)
})

test('excludes combined periods with a missing, partial, duplicate, or invalid shop row', () => {
  const accountIds = ['shop1', 'shop2', 'shop3', 'shop4']
  const baseRows = accountIds.map((accountId) => metric('2026-07', {
    id: `${accountId}:2026-07`,
    platform_account_id: accountId,
  }))

  assert.equal(aggregateCompleteAccountMetrics(baseRows.slice(0, 3), accountIds).length, 0)
  assert.equal(aggregateCompleteAccountMetrics(baseRows.map((row) => row.platform_account_id === 'shop4' ? { ...row, coverage_status: 'partial' } : row), accountIds).length, 0)
  assert.equal(aggregateCompleteAccountMetrics([...baseRows, { ...baseRows[0], id: 'duplicate' }], accountIds).length, 0)
  assert.equal(aggregateCompleteAccountMetrics(baseRows.map((row) => row.platform_account_id === 'shop4' ? { ...row, estimated_purchaser_count: null } : row), accountIds).length, 0)
})
