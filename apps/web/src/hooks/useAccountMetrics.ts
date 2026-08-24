import { useCallback, useEffect, useState } from 'react'
import type { AccountMetricsResponse } from '@lib/account-metrics-types'

export function useAccountMetrics(token: string) {
  const [data, setData] = useState<AccountMetricsResponse>({ accounts: [], metrics: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unauthorized, setUnauthorized] = useState(false)

  const fetchMetrics = useCallback(async () => {
    if (!token) {
      setData({ accounts: [], metrics: [] })
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    setUnauthorized(false)
    try {
      const response = await fetch('/api/account-metrics', {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      if (response.status === 401) {
        setUnauthorized(true)
        throw new Error('The manager access token was not accepted.')
      }
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
  }, [token])

  useEffect(() => { void fetchMetrics() }, [fetchMetrics])

  return { data, loading, error, unauthorized, refetch: fetchMetrics }
}

