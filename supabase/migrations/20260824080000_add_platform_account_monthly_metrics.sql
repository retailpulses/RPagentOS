-- Domain: product_catalog
-- Owner: retailpulses/RPagentOS
-- Affected: platform_account_monthly_metrics
-- Change class: additive
-- Hosted write required: yes
-- Consumers: none
-- Issue: https://github.com/retailpulses/RPagentOS/issues/70
-- Ownership registry: https://github.com/retailpulses/rp-governance-kit/issues/49
--
-- Rollback: drop platform_account_monthly_metrics only after confirming that no
-- downstream account-performance consumer has been activated.

create table platform_account_monthly_metrics (
  id uuid primary key default gen_random_uuid(),
  platform_account_id uuid not null
    references platform_accounts(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  source_as_of_date date,
  coverage_status text not null default 'complete'
    check (coverage_status in ('complete', 'partial', 'prelaunch', 'missing', 'unknown')),
  currency text not null default 'JPY',
  sales_amount numeric(16,2) not null check (sales_amount >= 0),
  visitor_count bigint not null check (visitor_count >= 0),
  reported_conversion_rate numeric(12,8)
    check (reported_conversion_rate between 0 and 1),
  reported_conversion_rate_reliable boolean not null default true,
  average_purchase_value numeric(14,2) not null
    check (average_purchase_value >= 0),
  new_follower_count bigint not null check (new_follower_count >= 0),
  estimated_purchaser_count bigint generated always as (
    case
      when average_purchase_value > 0
        then round(sales_amount / average_purchase_value)::bigint
      else null
    end
  ) stored,
  estimated_conversion_rate numeric(12,8) generated always as (
    case
      when average_purchase_value > 0 and visitor_count > 0
        then (sales_amount / average_purchase_value) / visitor_count
      else null
    end
  ) stored,
  source_system text not null,
  source_file text not null,
  source_import_run_id uuid references source_import_runs(id) on delete set null,
  source_row_number integer check (source_row_number is null or source_row_number > 1),
  quality_flags text[] not null default '{}'::text[],
  raw_payload jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_platform_account_monthly_metrics_period_start
    check (extract(day from period_start) = 1),
  constraint ck_platform_account_monthly_metrics_period_end
    check (period_end = (period_start + interval '1 month - 1 day')::date),
  constraint ck_platform_account_monthly_metrics_source_as_of
    check (source_as_of_date is null or source_as_of_date >= period_start),
  constraint uq_platform_account_monthly_metrics_account_period_source
    unique (platform_account_id, period_start, source_system)
);

create index ix_platform_account_monthly_metrics_account_period
  on platform_account_monthly_metrics (platform_account_id, period_start desc);

create index ix_platform_account_monthly_metrics_period
  on platform_account_monthly_metrics (period_start desc);

create trigger trg_platform_account_monthly_metrics_updated_at
before update on platform_account_monthly_metrics
for each row execute function set_updated_at();

alter table platform_account_monthly_metrics enable row level security;

revoke all on platform_account_monthly_metrics from anon, authenticated;
grant select, insert, update, delete on platform_account_monthly_metrics to service_role;

comment on table platform_account_monthly_metrics is
  'Monthly business-performance facts for every marketplace account. Reported low-precision metrics remain separate from transparent generated estimates.';
comment on column platform_account_monthly_metrics.reported_conversion_rate is
  'Source-reported ratio where 0.01 means 1%; consult reported_conversion_rate_reliable and quality_flags before analysis.';
comment on column platform_account_monthly_metrics.estimated_purchaser_count is
  'Non-authoritative estimate: round(sales_amount / average_purchase_value).';
comment on column platform_account_monthly_metrics.estimated_conversion_rate is
  'Non-authoritative ratio estimate: (sales_amount / average_purchase_value) / visitor_count.';
