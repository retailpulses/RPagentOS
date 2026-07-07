-- Listing Quality Engineering MVP Phase 3: event-triggered re-review cycles.
--
-- Creates the listing_quality_cycles table to track improvement loops for
-- listings across review → fix → re-review cycles.
--
-- Phase 3 scope:
--   - cycle management (before/after score delta tracking)
--   - event-triggered re-review queueing
--   - cycle status lifecycle (not_reviewed → ... → approved/published/rejected)

-- =============================================================================
-- 1. LISTING QUALITY CYCLES
-- =============================================================================

create table if not exists listing_quality_cycles (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null,
  marketplace text not null,
  cycle_status text not null default 'not_reviewed',
  baseline_snapshot_id uuid references listing_review_snapshots(id) on delete set null,
  latest_snapshot_id uuid references listing_review_snapshots(id) on delete set null,
  baseline_score real,
  latest_score real,
  score_delta real,
  created_from text,
  human_owner text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (marketplace in ('amazon', 'rakuten', 'mercari')),
  check (cycle_status in (
    'not_reviewed',
    'review_queued',
    'reviewed',
    'fix_needed',
    'fix_in_progress',
    'fix_ready_for_review',
    're_review_queued',
    'improved',
    'approved',
    'published',
    'rejected',
    'deferred'
  )),
  check (created_from is null or created_from in (
    'image_change',
    'title_change',
    'description_change',
    'product_facts_change',
    'work_item_completed',
    'new_listing_imported',
    'hero_promotion',
    'manual_request'
  ))
);

create index if not exists idx_lqc_listing
  on listing_quality_cycles(listing_id, marketplace);

create index if not exists idx_lqc_status
  on listing_quality_cycles(cycle_status);

-- =============================================================================
-- 2. GRANT PERMISSIONS
-- =============================================================================

do $$
begin
  execute format('grant select, insert, update, delete on %I to authenticated', 'listing_quality_cycles');
  execute format('grant select, insert, update, delete on %I to service_role', 'listing_quality_cycles');
  execute format('grant select on %I to anon', 'listing_quality_cycles');
end
$$;
