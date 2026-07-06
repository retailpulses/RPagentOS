-- Listing Intelligence MVP-1: local Qwen review storage.
-- Qwen writes are performed by local/server-side service-role jobs. The browser
-- client can read completed reviews for the workbench detail panel.

create table if not exists listing_intelligence_runs (
  id uuid primary key default gen_random_uuid(),
  run_type text not null,
  status text not null default 'running',
  work_item_id uuid references listing_work_items(id) on delete set null,
  platform text,
  shop_code text,
  source_snapshot_hash text,
  source_snapshot_version integer,
  metadata jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz default now(),
  completed_at timestamptz,
  check (run_type in ('qwen_review')),
  check (status in ('running', 'completed', 'failed'))
);

create table if not exists listing_intelligence_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references listing_intelligence_runs(id) on delete cascade,
  work_item_id uuid references listing_work_items(id) on delete cascade,
  result_type text not null,
  status text not null default 'pending',
  source_snapshot_hash text,
  source_snapshot_version integer,
  payload jsonb not null default '{}'::jsonb,
  validation_status text not null default 'pending',
  validation_errors jsonb not null default '[]'::jsonb,
  created_at timestamptz default now(),
  check (result_type in ('qwen_review')),
  check (status in ('pending', 'ready', 'invalid', 'failed', 'stale')),
  check (validation_status in ('pending', 'valid', 'repaired', 'invalid', 'failed'))
);

create table if not exists listing_qwen_reviews (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references listing_intelligence_runs(id) on delete cascade,
  result_id uuid references listing_intelligence_results(id) on delete cascade,
  work_item_id uuid references listing_work_items(id) on delete cascade,
  llm_provider text not null default 'local',
  llm_runtime text not null default 'ollama',
  llm_model text not null,
  prompt_profile text not null,
  prompt_version text not null,
  input_hash text,
  output_hash text,
  source_snapshot_hash text,
  source_snapshot_version integer,
  risk_level text not null default 'medium',
  confidence numeric,
  summary text,
  issues jsonb not null default '[]'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  suggested_title text,
  suggested_description text,
  suggested_image_plan jsonb not null default '[]'::jsonb,
  structured_output jsonb not null default '{}'::jsonb,
  raw_request jsonb,
  raw_response jsonb,
  validation_status text not null default 'pending',
  validation_errors jsonb not null default '[]'::jsonb,
  repair_attempts integer not null default 0,
  error_message text,
  created_at timestamptz default now(),
  check (risk_level in ('low', 'medium', 'high', 'critical')),
  check (validation_status in ('pending', 'valid', 'repaired', 'invalid', 'failed'))
);

create index if not exists idx_listing_intelligence_runs_work_item
  on listing_intelligence_runs(work_item_id, started_at desc);
create index if not exists idx_listing_intelligence_results_work_item
  on listing_intelligence_results(work_item_id, created_at desc);
create index if not exists idx_listing_qwen_reviews_work_item
  on listing_qwen_reviews(work_item_id, created_at desc);
create index if not exists idx_listing_qwen_reviews_validation
  on listing_qwen_reviews(validation_status);

grant select, insert, update, delete on listing_intelligence_runs to authenticated;
grant select, insert, update, delete on listing_intelligence_runs to service_role;
grant select on listing_intelligence_runs to anon;

grant select, insert, update, delete on listing_intelligence_results to authenticated;
grant select, insert, update, delete on listing_intelligence_results to service_role;
grant select on listing_intelligence_results to anon;

grant select, insert, update, delete on listing_qwen_reviews to authenticated;
grant select, insert, update, delete on listing_qwen_reviews to service_role;
grant select on listing_qwen_reviews to anon;
