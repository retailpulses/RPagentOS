-- Listing Quality Engineering MVP Phase 1: scheduled technical/OCR review.
-- Creates the core review infrastructure tables: policies, jobs, snapshots,
-- snapshot images, and review results.
--
-- Phase 1 scope:
--   - scheduled review policies
--   - async job tracking
--   - listing state snapshots
--   - per-image technical/OCR capture
--   - review results with completeness tracking
--
-- Work item creation and marketplace scoring start in Phase 2.
-- Qwen visual review starts in Phase 4.
-- Quality cycles (before/after delta) start in Phase 5.

-- ============================================================================
-- 1. LISTING REVIEW POLICIES
-- ============================================================================

create table if not exists listing_review_policies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  marketplace text not null,
  scope_type text not null default 'curated',
  scope_filter_json jsonb default '{}'::jsonb,
  review_type text not null,
  schedule_cron text,
  priority integer not null default 100,
  qwen_enabled boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  check (marketplace in ('amazon', 'rakuten', 'mercari')),
  check (scope_type in ('curated', 'hero_products', 'active_with_images', 'all_active', 'custom')),
  check (review_type in ('daily_technical', 'weekly_quality', 'manual', 'event_triggered'))
);

create index if not exists ix_review_policies_marketplace
  on listing_review_policies(marketplace);

create index if not exists ix_review_policies_active
  on listing_review_policies(is_active)
  where is_active = true;

-- ============================================================================
-- 2. LISTING REVIEW JOBS
-- ============================================================================

create table if not exists listing_review_jobs (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid,
  cycle_id uuid,
  trigger_source text not null default 'scheduled',
  trigger_policy_id uuid references listing_review_policies(id) on delete set null,
  marketplace text not null,
  review_type text not null,
  status text not null default 'queued',
  priority integer not null default 100,
  scheduled_for timestamptz,
  requested_by text,
  model_name text,
  ocr_engine text default 'tesseract',
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  started_at timestamptz,
  completed_at timestamptz,
  error_type text,
  error_message text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  check (marketplace in ('amazon', 'rakuten', 'mercari')),
  check (review_type in ('daily_technical', 'weekly_quality', 'manual', 'event_triggered')),
  check (trigger_source in ('scheduled', 'event', 'manual', 're_review')),
  check (status in ('queued', 'running', 'completed', 'failed', 'cancelled'))
);

create index if not exists ix_review_jobs_status
  on listing_review_jobs(status);

create index if not exists ix_review_jobs_snapshot
  on listing_review_jobs(snapshot_id);

create index if not exists ix_review_jobs_policy
  on listing_review_jobs(trigger_policy_id);

create index if not exists ix_review_jobs_scheduled
  on listing_review_jobs(status, scheduled_for)
  where status = 'queued';

-- ============================================================================
-- 3. LISTING REVIEW SNAPSHOTS
-- ============================================================================

create table if not exists listing_review_snapshots (
  id uuid primary key default gen_random_uuid(),
  marketplace text not null,
  listing_id uuid references platform_listings(id) on delete cascade,
  external_listing_id text,
  shop_code text,
  product_spu_id uuid references product_spus(id) on delete set null,
  product_family_id uuid references product_families(id) on delete set null,
  is_hero_product boolean not null default false,
  title text,
  description text,
  bullet_points_json jsonb,
  price numeric(12,2),
  image_urls_json jsonb,
  product_facts_json jsonb,
  marketplace_status text,
  source_hash text not null,
  created_at timestamptz default now(),
  check (marketplace in ('amazon', 'rakuten', 'mercari'))
);

create index if not exists ix_snapshots_listing
  on listing_review_snapshots(listing_id, created_at desc);

create index if not exists ix_snapshots_marketplace
  on listing_review_snapshots(marketplace);

create index if not exists ix_snapshots_source_hash
  on listing_review_snapshots(listing_id, source_hash);

create index if not exists ix_snapshots_spu
  on listing_review_snapshots(product_spu_id);

-- ============================================================================
-- 4. LISTING REVIEW SNAPSHOT IMAGES
-- ============================================================================

create table if not exists listing_review_snapshot_images (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid references listing_review_snapshots(id) on delete cascade,
  image_index integer not null,
  image_url text,
  source_asset_id uuid references product_assets(id) on delete set null,
  platform_image_id uuid references platform_listing_images(id) on delete set null,
  is_main_image boolean not null default false,
  url_hash text,
  content_hash text,
  http_status integer,
  width integer,
  height integer,
  byte_size integer,
  loaded boolean not null default false,
  load_error text,
  ocr_text text,
  ocr_blocks_json jsonb,
  ocr_engine text,
  created_at timestamptz default now()
);

create index if not exists ix_snapshot_images_snapshot
  on listing_review_snapshot_images(snapshot_id);

create index if not exists ix_snapshot_images_loaded
  on listing_review_snapshot_images(snapshot_id, loaded);

create index if not exists ix_snapshot_images_url_hash
  on listing_review_snapshot_images(snapshot_id, url_hash);

create index if not exists ix_snapshot_images_content_hash
  on listing_review_snapshot_images(snapshot_id, content_hash);

-- ============================================================================
-- 5. LISTING REVIEW RESULTS
-- ============================================================================

create table if not exists listing_review_results (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid references listing_review_snapshots(id) on delete cascade,
  job_id uuid references listing_review_jobs(id) on delete set null,
  review_type text not null,
  model_name text,
  ocr_engine text,
  scoring_version text,
  technical_score numeric(5,2),
  content_score numeric(5,2),
  image_score numeric(5,2),
  compliance_score numeric(5,2),
  conversion_score numeric(5,2),
  operational_risk_score numeric(5,2),
  final_score numeric(5,2),
  confidence text not null default 'low',
  score_status text not null default 'partial',
  score_completeness_json jsonb default '{}'::jsonb,
  review_completeness text,
  issues_json jsonb default '[]'::jsonb,
  recommendations_json jsonb default '[]'::jsonb,
  raw_outputs_json jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  check (review_type in ('daily_technical', 'weekly_quality', 'manual', 'event_triggered')),
  check (confidence in ('low', 'medium', 'high')),
  check (score_status in ('partial', 'complete', 'failed')),
  check (review_completeness is null or review_completeness in (
    'technical_only',
    'technical_ocr',
    'technical_ocr_marketplace',
    'technical_ocr_qwen',
    'full_review'
  ))
);

create index if not exists ix_review_results_snapshot
  on listing_review_results(snapshot_id, created_at desc);

create index if not exists ix_review_results_score
  on listing_review_results(snapshot_id, final_score);

create index if not exists ix_review_results_confidence
  on listing_review_results(confidence);

-- ============================================================================
-- 6. GRANT PERMISSIONS
-- ============================================================================

do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'listing_review_policies',
      'listing_review_jobs',
      'listing_review_snapshots',
      'listing_review_snapshot_images',
      'listing_review_results'
    ])
  loop
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format('grant select, insert, update, delete on %I to service_role', t);
    execute format('grant select on %I to anon', t);
  end loop;
end
$$;
