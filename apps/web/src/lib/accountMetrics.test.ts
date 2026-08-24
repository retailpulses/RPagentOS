import assert from 'node:assert/strict'
import test from 'node:test'
import type { PlatformAccountMonthlyMetric } from '../../../../src/lib/account-metrics-types.js'
import { buildManagementSignals, latestCompleteComparison } from './accountMetrics.js'

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
