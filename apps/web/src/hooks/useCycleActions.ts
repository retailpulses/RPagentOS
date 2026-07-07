import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const MISSING_SUPABASE_MESSAGE = 'Cycle actions unavailable. Configure Supabase for this deployment.'

type CycleStatus =
  | 'not_reviewed'
  | 'review_queued'
  | 'reviewed'
  | 'fix_needed'
  | 'fix_in_progress'
  | 'fix_ready_for_review'
  | 're_review_queued'
  | 'improved'
  | 'approved'
  | 'published'
  | 'rejected'
  | 'deferred'

export type { CycleStatus }

export function useCycleActions() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const updateCycle = useCallback(async (cycleId: string, status: CycleStatus): Promise<{ ok: boolean; error?: string }> => {
    if (!supabase) {
      const msg = MISSING_SUPABASE_MESSAGE
      setError(msg)
      return { ok: false, error: msg }
    }

    setLoading(true)
    setError(null)
    try {
      const { error: updateError } = await supabase
        .from('listing_quality_cycles')
        .update({ cycle_status: status, updated_at: new Date().toISOString() })
        .eq('id', cycleId)

      if (updateError) throw updateError
      return { ok: true }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to update cycle'
      setError(message)
      return { ok: false, error: message }
    } finally {
      setLoading(false)
    }
  }, [])

  const approveCycle = useCallback(async (cycleId: string): Promise<{ ok: boolean; error?: string }> => {
    return updateCycle(cycleId, 'approved')
  }, [updateCycle])

  const deferCycle = useCallback(async (cycleId: string): Promise<{ ok: boolean; error?: string }> => {
    return updateCycle(cycleId, 'deferred')
  }, [updateCycle])

  const rejectCycle = useCallback(async (cycleId: string): Promise<{ ok: boolean; error?: string }> => {
    return updateCycle(cycleId, 'rejected')
  }, [updateCycle])

  return { updateCycle, approveCycle, deferCycle, rejectCycle, loading, error }
}
