-- Phase 4: Add async Qwen review columns to listing_qwen_review_requests.
-- These support the queued async visual review approach where the listing
-- quality pipeline enqueues requests and the bridge worker processes them.

alter table listing_qwen_review_requests
  add column if not exists image_urls_json jsonb not null default '[]'::jsonb,
  add column if not exists prompt_profile text not null default 'listing_quality_visual',
  add column if not exists max_attempts integer not null default 3,
  add column if not exists timeout_seconds integer not null default 240,
  add column if not exists priority integer not null default 5;

-- Index for priority-based ordering so bridge processes critical items first
create index if not exists idx_listing_qwen_review_requests_priority
  on listing_qwen_review_requests(priority desc, created_at asc)
  where status = 'queued';
