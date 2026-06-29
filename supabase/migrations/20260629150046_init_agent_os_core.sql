-- Agent OS Core: initial schema
-- Tables: products, product_variants, platform_listings,
--         promotion_candidates, agent_decisions, human_approvals, agent_execution_logs

-- ── products ──────────────────────────────────────────
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  spu_code text,
  title text not null,
  category text,
  status text default 'active',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── product_variants ──────────────────────────────────
create table if not exists product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products(id) on delete cascade,
  sku text unique not null,
  variant_name text,
  color text,
  size_text text,
  status text default 'active',
  created_at timestamptz default now()
);

-- ── platform_listings ─────────────────────────────────
create table if not exists platform_listings (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid references product_variants(id) on delete cascade,
  platform text not null,
  shop_code text not null,
  external_listing_id text,
  title text,
  url text,
  current_price numeric(12,2),
  stock_qty integer default 0,
  listing_status text default 'active',
  raw_payload jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(platform, shop_code, external_listing_id)
);

-- ── promotion_candidates ──────────────────────────────
create table if not exists promotion_candidates (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references platform_listings(id) on delete cascade,
  candidate_type text not null,
  reason text,
  suggested_discount_rate numeric(5,2),
  suggested_price numeric(12,2),
  status text default 'pending',
  created_at timestamptz default now()
);

-- ── agent_decisions ───────────────────────────────────
create table if not exists agent_decisions (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references promotion_candidates(id) on delete cascade,
  agent_name text not null,
  model_name text,
  decision text not null,
  confidence numeric(5,2),
  reasoning_summary text,
  input_snapshot jsonb,
  output_snapshot jsonb,
  created_at timestamptz default now()
);

-- ── human_approvals ──────────────────────────────────
create table if not exists human_approvals (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references promotion_candidates(id) on delete cascade,
  reviewer text,
  action text not null,
  comment text,
  created_at timestamptz default now()
);

-- ── agent_execution_logs ──────────────────────────────
create table if not exists agent_execution_logs (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references promotion_candidates(id) on delete cascade,
  action_type text not null,
  target_platform text,
  target_shop_code text,
  status text not null,
  request_payload jsonb,
  response_payload jsonb,
  error_message text,
  created_at timestamptz default now()
);

-- ── indexes ───────────────────────────────────────────
create index if not exists idx_platform_listings_platform_shop
  on platform_listings(platform, shop_code);
create index if not exists idx_promotion_candidates_status
  on promotion_candidates(status);
create index if not exists idx_agent_execution_logs_status
  on agent_execution_logs(status);

-- ── permissions ────────────────────────────────────────
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
