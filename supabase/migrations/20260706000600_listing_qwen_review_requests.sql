-- MVP-1 live-safe Qwen requests. The static workbench inserts a queued request
-- with the anon key; the local Qwen bridge polls and processes it with the
-- service-role key and local Ollama.

create table if not exists listing_qwen_review_requests (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references listing_work_items(id) on delete cascade,
  status text not null default 'queued',
  force boolean not null default false,
  llm_model text,
  review_id uuid references listing_qwen_reviews(id) on delete set null,
  error_message text,
  requested_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  completed_at timestamptz,
  check (status in ('queued', 'running', 'completed', 'failed'))
);

create index if not exists idx_listing_qwen_review_requests_status
  on listing_qwen_review_requests(status, created_at);
create index if not exists idx_listing_qwen_review_requests_work_item
  on listing_qwen_review_requests(work_item_id, created_at desc);

grant select, insert on listing_qwen_review_requests to anon;
grant select, insert, update, delete on listing_qwen_review_requests to authenticated;
grant select, insert, update, delete on listing_qwen_review_requests to service_role;
