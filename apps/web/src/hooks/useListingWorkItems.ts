import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const DEFAULT_PAGE_SIZE = 200
const MISSING_SUPABASE_MESSAGE = 'Listing workbench is not connected. Configure Supabase for this deployment.'

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

export function useListingWorkItemOptions(items: ListingWorkItem[]) {
  return useMemo(() => {
    const collect = (getter: (item: ListingWorkItem) => string | null | undefined) => {
      return Array.from(new Set(items.map(getter).filter(Boolean) as string[])).sort()
    }
    return {
      platforms: collect(item => item.platform),
      shops: collect(item => item.shop_code),
      workflowTypes: collect(item => item.workflow_type),
      issueTypes: collect(item => item.issue_type),
      statuses: collect(item => item.status),
    }
  }, [items])
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
