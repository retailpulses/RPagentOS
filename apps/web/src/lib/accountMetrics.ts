import type { PlatformAccountMonthlyMetric } from '../../../../src/lib/account-metrics-types.js'

export type MetricKey = 'sales_amount' | 'visitor_count' | 'estimated_conversion_rate' | 'average_purchase_value' | 'new_follower_count'

export interface ManagementSignal {
  key: string
  severity: 'high' | 'medium' | 'opportunity'
  title: string
  evidence: string
  recommendation: string
}

export function percentChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null
  return ((current - previous) / previous) * 100
}

export function completePeriods(rows: PlatformAccountMonthlyMetric[]): PlatformAccountMonthlyMetric[] {
  return rows
    .filter((row) => row.coverage_status === 'complete')
    .sort((a, b) => a.period_start.localeCompare(b.period_start))
}

function value(row: PlatformAccountMonthlyMetric, key: MetricKey): number | null {
  const result = row[key]
  return typeof result === 'number' ? result : null
}

export function latestCompleteComparison(rows: PlatformAccountMonthlyMetric[]): {
  latest: PlatformAccountMonthlyMetric | null
  previous: PlatformAccountMonthlyMetric | null
} {
  const periods = completePeriods(rows)
  return {
    latest: periods.length > 0 ? periods[periods.length - 1] : null,
    previous: periods.length > 1 ? periods[periods.length - 2] : null,
  }
}

export function metricChange(
  latest: PlatformAccountMonthlyMetric | null,
  previous: PlatformAccountMonthlyMetric | null,
  key: MetricKey,
): number | null {
  if (!latest || !previous) return null
  return percentChange(value(latest, key), value(previous, key))
}

function followersPerThousand(row: PlatformAccountMonthlyMetric): number | null {
  return row.visitor_count > 0 ? (row.new_follower_count / row.visitor_count) * 1000 : null
}

function signedPercent(change: number | null): string {
  if (change === null) return 'n/a'
  return `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`
}

export function buildManagementSignals(rows: PlatformAccountMonthlyMetric[]): ManagementSignal[] {
  const { latest, previous } = latestCompleteComparison(rows)
  if (!latest || !previous) {
    return [{
      key: 'insufficient-history',
      severity: 'medium',
      title: 'Build a reliable baseline',
      evidence: 'At least two complete monthly periods are required for account-level trend signals.',
      recommendation: 'Confirm the next complete monthly export and review data-quality flags before planning an intervention.',
    }]
  }

  const sales = metricChange(latest, previous, 'sales_amount')
  const visitors = metricChange(latest, previous, 'visitor_count')
  const conversion = metricChange(latest, previous, 'estimated_conversion_rate')
  const purchaseValue = metricChange(latest, previous, 'average_purchase_value')
  const followerRate = percentChange(followersPerThousand(latest), followersPerThousand(previous))
  const periodEvidence = `${previous.period_start.slice(0, 7)} → ${latest.period_start.slice(0, 7)}`
  const signals: ManagementSignal[] = []

  if (visitors !== null && visitors <= -20) {
    signals.push({
      key: 'traffic-decline',
      severity: visitors <= -35 ? 'high' : 'medium',
      title: 'Recover qualified traffic',
      evidence: `${periodEvidence}: visitors ${signedPercent(visitors)}, sales ${signedPercent(sales)}.`,
      recommendation: 'Review search visibility, active listing coverage, new-product cadence, ads, and promotion participation before increasing discount depth.',
    })
  }

  if (conversion !== null && conversion <= -15 && (visitors === null || visitors > -15)) {
    signals.push({
      key: 'conversion-decline',
      severity: conversion <= -30 ? 'high' : 'medium',
      title: 'Run a conversion recovery review',
      evidence: `${periodEvidence}: estimated conversion ${signedPercent(conversion)} while visitors changed ${signedPercent(visitors)}.`,
      recommendation: 'Audit high-traffic listings for price competitiveness, stock, delivery promise, image quality, product information, and review friction.',
    })
  }

  if (purchaseValue !== null && purchaseValue <= -10) {
    signals.push({
      key: 'purchase-value-decline',
      severity: purchaseValue <= -20 ? 'high' : 'medium',
      title: 'Protect purchase value',
      evidence: `${periodEvidence}: average purchase value ${signedPercent(purchaseValue)}.`,
      recommendation: 'Review product mix and discount depth, then test bundles, complementary products, or higher-value hero listings.',
    })
  }

  if (followerRate !== null && followerRate <= -20) {
    signals.push({
      key: 'follower-efficiency-decline',
      severity: 'medium',
      title: 'Improve visitor-to-follower retention',
      evidence: `${periodEvidence}: new followers per 1,000 visitors ${signedPercent(followerRate)}.`,
      recommendation: 'Review follow incentives, shop positioning, repeat-purchase messaging, and whether incoming traffic matches the target customer.',
    })
  }

  if (signals.length === 0) {
    signals.push({
      key: 'growth-opportunity',
      severity: 'opportunity',
      title: 'Plan the next growth experiment',
      evidence: `${periodEvidence}: no core KPI crossed the MVP decline thresholds; sales changed ${signedPercent(sales)}.`,
      recommendation: 'Choose one bounded traffic, conversion, or basket-size experiment and define the expected metric movement before launch.',
    })
  }

  return signals
}
