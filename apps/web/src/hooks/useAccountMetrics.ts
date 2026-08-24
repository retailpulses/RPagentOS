import { useCallback, useEffect, useState } from 'react'
import type { AccountMetricsResponse, ManualAccountMetricInput, PlatformAccountMonthlyMetric } from '@lib/account-metrics-types'

export function useAccountMetrics() {
  const [data, setData] = useState<AccountMetricsResponse>({ accounts: [], metrics: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)

  const fetchMetrics = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/account-metrics', {
        cache: 'no-store',
      })
      if (response.status === 503) {
        throw new Error('Account Metrics is not configured for this deployment.')
      }
      if (!response.ok) {
        throw new Error('Account metrics could not be loaded.')
      }
      setData(await response.json() as AccountMetricsResponse)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Account metrics could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchMetrics() }, [fetchMetrics])

  const createManualMetric = useCallback(async (input: ManualAccountMetricInput): Promise<PlatformAccountMonthlyMetric | null> => {
    setSaving(true)
    setMutationError(null)
    try {
      const response = await fetch('/api/account-metrics', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })
      const payload = await response.json() as { metric?: PlatformAccountMonthlyMetric; error?: string }
      if (response.status === 409) throw new Error('This account already has metrics for the selected month. Existing data was not changed.')
      if (response.status === 404) throw new Error('The selected account is no longer active.')
      if (!response.ok || !payload.metric) throw new Error('The monthly metric could not be saved. Check every field and try again.')
      await fetchMetrics()
      return payload.metric
    } catch (caught) {
      setMutationError(caught instanceof Error ? caught.message : 'The monthly metric could not be saved.')
      return null
    } finally {
      setSaving(false)
    }
  }, [fetchMetrics])

  return { data, loading, error, saving, mutationError, refetch: fetchMetrics, createManualMetric }
}
