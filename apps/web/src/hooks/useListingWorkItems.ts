import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const DEFAULT_PAGE_SIZE = 200
const MISSING_SUPABASE_MESSAGE = 'Listing workbench is not connected. Configure Supabase for this deployment.'
const QWEN_BRIDGE_URL = import.meta.env.VITE_QWEN_BRIDGE_URL || 'http://127.0.0.1:8788'

export interface ListingWorkItem {
  id: string
  workflow_type: string
  issue_type: string | null
  recommended_action: string | null
  target_type: string
  target_id: string
  target_key: string
  platform: string | null
  shop_code: string | null
  product_family_id: string | null
  product_spu_id: string | null
  variant_id: string | null
  bundle_id: string | null
  listing_id: string | null
  listing_sku_id: string | null
  priority_score: number
  business_priority: string
  issue_severity: string
  is_hero: boolean
  hero_scope: string | null
  hero_priority: number | null
  hero_reason: string | null
  target_platforms: string[] | null
  listing_strategy_status: string | null
  human_input_level: string
  status: string
  assigned_to: string | null
  source_context: Record<string, unknown>
  source_snapshot_hash: string | null
  source_snapshot_version: number
  classification_reasons: Array<Record<string, unknown>>
  deterministic_findings: Array<Record<string, unknown>>
  latest_result_id: string | null
  created_at: string
  updated_at: string
}

export interface ListingWorkItemFilters {
  platform?: string
  shopCode?: string
  workflowType?: string
  issueType?: string
  status?: string
  heroOnly?: boolean
  search?: string
}

export interface ListingQwenReview {
  id: string
  run_id: string | null
  result_id: string | null
  work_item_id: string
  llm_provider: string
  llm_runtime: string
  llm_model: string
  prompt_profile: string
  prompt_version: string
  risk_level: string
  confidence: number | null
  summary: string | null
  issues: Array<Record<string, unknown>>
  recommendations: Array<Record<string, unknown>>
  suggested_title: string | null
  suggested_description: string | null
  suggested_image_plan: Array<Record<string, unknown>>
  structured_output: Record<string, unknown>
  validation_status: string
  validation_errors: Array<Record<string, unknown>> | string[]
  repair_attempts: number
  error_message: string | null
  source_snapshot_hash: string | null
  source_snapshot_version: number | null
  created_at: string
}

function matchesSearch(item: ListingWorkItem, search: string) {
  const query = search.trim().toLowerCase()
  if (!query) return true
  const context = item.source_context ?? {}
  const haystack = [
    item.target_key,
    item.platform,
    item.shop_code,
    item.workflow_type,
    item.issue_type,
    item.recommended_action,
    item.target_type,
    item.target_id,
    item.listing_id,
    item.listing_sku_id,
    item.variant_id,
    item.product_spu_id,
    String(context['title'] ?? ''),
    String(context['external_listing_id'] ?? ''),
    String(context['seller_sku'] ?? ''),
    String(context['sku_code'] ?? ''),
    String(context['asin'] ?? ''),
    String(context['spu_code'] ?? ''),
  ].filter(Boolean).join(' ').toLowerCase()
  return haystack.includes(query)
}

export function useListingWorkItems(filters: ListingWorkItemFilters = {}) {
  const [data, setData] = useState<ListingWorkItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const filterKey = JSON.stringify(filters)

  const fetch = useCallback(async () => {
    if (!supabase) {
      setData([])
      setError(MISSING_SUPABASE_MESSAGE)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    try {
      let query = supabase
        .from('listing_work_items')
        .select('*')
        .order('priority_score', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(DEFAULT_PAGE_SIZE)

      if (filters.platform) query = query.eq('platform', filters.platform)
      if (filters.shopCode) query = query.eq('shop_code', filters.shopCode)
      if (filters.workflowType) query = query.eq('workflow_type', filters.workflowType)
      if (filters.issueType) query = query.eq('issue_type', filters.issueType)
      if (filters.status) query = query.eq('status', filters.status)
      if (filters.heroOnly) query = query.eq('is_hero', true)

      const { data: rows, error: queryError } = await query
      if (queryError) throw queryError

      const typed = (rows ?? []) as ListingWorkItem[]
      setData(filters.search ? typed.filter(item => matchesSearch(item, filters.search ?? '')) : typed)
    } catch (e: unknown) {
      setData([])
      setError(e instanceof Error ? e.message : 'Failed to load listing work items')
    } finally {
      setLoading(false)
    }
  }, [filterKey])

  useEffect(() => { void fetch() }, [fetch])

  return { data, loading, error, refetch: fetch }
}

interface ListingWorkItemOptionRow {
  platform: string | null
  shop_code: string | null
  workflow_type: string
  issue_type: string | null
  status: string
}

const EMPTY_OPTIONS = {
  platforms: [] as string[],
  shops: [] as string[],
  workflowTypes: [] as string[],
  issueTypes: [] as string[],
  statuses: [] as string[],
}

export function useListingWorkItemOptions() {
  const [options, setOptions] = useState(EMPTY_OPTIONS)

  useEffect(() => {
    let cancelled = false

    async function fetchOptions() {
      if (!supabase) {
        setOptions(EMPTY_OPTIONS)
        return
      }

      const rows: ListingWorkItemOptionRow[] = []
      let from = 0

      while (!cancelled) {
        const { data, error } = await supabase
          .from('listing_work_items')
          .select('platform, shop_code, workflow_type, issue_type, status')
          .range(from, from + 999)

        if (error) throw error
        rows.push(...((data ?? []) as ListingWorkItemOptionRow[]))
        if (!data || data.length < 1000) break
        from += 1000
      }

      if (cancelled) return

      const collect = (getter: (item: ListingWorkItemOptionRow) => string | null | undefined) => {
        return Array.from(new Set(rows.map(getter).filter(Boolean) as string[])).sort()
      }

      setOptions({
        platforms: collect(item => item.platform),
        shops: collect(item => item.shop_code),
        workflowTypes: collect(item => item.workflow_type),
        issueTypes: collect(item => item.issue_type),
        statuses: collect(item => item.status),
      })
    }

    void fetchOptions().catch(() => {
      if (!cancelled) setOptions(EMPTY_OPTIONS)
    })

    return () => {
      cancelled = true
    }
  }, [])

  return options
}

export function useUpdateListingWorkItemStatus() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = async (id: string, status: string): Promise<ListingWorkItem | null> => {
    if (!supabase) {
      setError(MISSING_SUPABASE_MESSAGE)
      return null
    }
    setLoading(true)
    setError(null)
    try {
      const { data, error: updateError } = await supabase
        .from('listing_work_items')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()

      if (updateError) throw updateError
      return data as ListingWorkItem
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update work item')
      return null
    } finally {
      setLoading(false)
    }
  }

  return { update, loading, error }
}

export function useLatestQwenReview(workItemId: string | null | undefined) {
  const [data, setData] = useState<ListingQwenReview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!workItemId || !supabase) {
      setData(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const { data: rows, error: queryError } = await supabase
        .from('listing_qwen_reviews')
        .select('*')
        .eq('work_item_id', workItemId)
        .order('created_at', { ascending: false })
        .limit(1)

      if (queryError) throw queryError
      setData((rows?.[0] as ListingQwenReview | undefined) ?? null)
    } catch (e: unknown) {
      setData(null)
      setError(e instanceof Error ? e.message : 'Failed to load Qwen review')
    } finally {
      setLoading(false)
    }
  }, [workItemId])

  useEffect(() => { void fetch() }, [fetch])

  return { data, loading, error, refetch: fetch }
}

export function useRunQwenReview() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (workItemId: string, force = false): Promise<{ ok: boolean; error?: string }> => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`${QWEN_BRIDGE_URL}/reviews`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ work_item_id: workItemId, force }),
      })
      const body = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(body.error ?? `Qwen bridge returned ${response.status}`)
      return { ok: true }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to run Qwen review'
      setError(message)
      return { ok: false, error: message }
    } finally {
      setLoading(false)
    }
  }

  return { run, loading, error }
}
