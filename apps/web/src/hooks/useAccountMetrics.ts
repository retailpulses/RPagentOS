import { useCallback, useEffect, useState } from 'react'
import type { AccountMetricsResponse } from '@lib/account-metrics-types'

export function useAccountMetrics() {
  const [data, setData] = useState<AccountMetricsResponse>({ accounts: [], metrics: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  return { data, loading, error, refetch: fetchMetrics }
}
