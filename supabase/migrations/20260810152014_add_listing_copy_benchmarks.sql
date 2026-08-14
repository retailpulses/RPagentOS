-- Domain: listing_intelligence
-- Owner: retailpulses/RPagentOS
-- Affected: listing_copy_benchmark_sets, listing_copy_benchmark_items, activate_listing_copy_benchmark_set
-- Change class: additive
-- Hosted write required: yes
-- Consumers: none

create table if not exists listing_copy_benchmark_sets (
  id uuid primary key default gen_random_uuid(),
  marketplace text not null,
  category_id text,
  category_name text,
  scope_key text not null,
  version integer not null,
  status text not null default 'draft',
  selection_mode text not null default 'automatic',
  source_kind text not null,
  source_query_json jsonb not null default '{}'::jsonb,
  target_profile_json jsonb not null default '{}'::jsonb,
  methodology_version text not null,
  content_hash text not null,
  captured_at timestamptz not null,
  activated_at timestamptz,
  retired_at timestamptz,
  designated_by text,
  created_at timestamptz not null default now(),
  check (marketplace in ('rakuten', 'mercari')),
  check (status in ('draft', 'active', 'retired')),
  check (selection_mode in ('automatic', 'operator')),
  check (version > 0),
  check (category_id is not null or category_name is not null)
);

create unique index if not exists ux_listing_copy_benchmark_sets_version
  on listing_copy_benchmark_sets (
    marketplace,
    coalesce(category_id, ''),
    coalesce(category_name, ''),
    scope_key,
    version
  );

create unique index if not exists ux_listing_copy_benchmark_sets_active
  on listing_copy_benchmark_sets (
    marketplace,
    coalesce(category_id, ''),
    coalesce(category_name, ''),
    scope_key
  )
  where status = 'active';

create index if not exists ix_listing_copy_benchmark_sets_resolution
  on listing_copy_benchmark_sets (marketplace, category_id, category_name, scope_key, status, captured_at desc);

create table if not exists listing_copy_benchmark_items (
  id uuid primary key default gen_random_uuid(),
  benchmark_set_id uuid not null references listing_copy_benchmark_sets(id) on delete cascade,
  external_listing_id text not null,
  listing_url text,
  shop_code text,
  rank_position integer,
  is_sponsored boolean not null default false,
  title text not null,
  description text,
  price numeric(12,2),
  rating numeric(3,2),
  review_count integer,
  source_metadata_json jsonb not null default '{}'::jsonb,
  content_hash text not null,
  captured_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (benchmark_set_id, external_listing_id),
  check (rank_position is null or rank_position > 0),
  check (review_count is null or review_count >= 0)
);

create index if not exists ix_listing_copy_benchmark_items_set_rank
  on listing_copy_benchmark_items (benchmark_set_id, rank_position);

alter table listing_copy_benchmark_sets enable row level security;
alter table listing_copy_benchmark_items enable row level security;

revoke all on listing_copy_benchmark_sets from anon, authenticated;
revoke all on listing_copy_benchmark_items from anon, authenticated;
grant select, insert, update, delete on listing_copy_benchmark_sets to service_role;
grant select, insert, update, delete on listing_copy_benchmark_items to service_role;

comment on table listing_copy_benchmark_sets is
  'Versioned, frozen category targets for listing copy evaluation. Changing a target creates a new version.';
comment on table listing_copy_benchmark_items is
  'Captured marketplace listings supporting a fixed benchmark set; benchmark copy is not product-fact evidence.';

create or replace function activate_listing_copy_benchmark_set(p_set_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target listing_copy_benchmark_sets%rowtype;
  activated_time timestamptz := now();
begin
  select * into target
  from listing_copy_benchmark_sets
  where id = p_set_id
  for update;

  if not found then
    raise exception 'benchmark set % not found', p_set_id;
  end if;
  if target.status <> 'draft' then
    raise exception 'only draft benchmark sets may be activated';
  end if;
  if target.selection_mode = 'automatic' and exists (
    select 1
    from listing_copy_benchmark_sets current_target
    where current_target.marketplace = target.marketplace
      and current_target.category_id is not distinct from target.category_id
      and current_target.category_name is not distinct from target.category_name
      and current_target.scope_key = target.scope_key
      and current_target.status = 'active'
      and current_target.selection_mode = 'operator'
  ) then
    raise exception 'automatic benchmark may not replace an active operator benchmark';
  end if;

  update listing_copy_benchmark_sets
  set status = 'retired', retired_at = activated_time
  where marketplace = target.marketplace
    and category_id is not distinct from target.category_id
    and category_name is not distinct from target.category_name
    and scope_key = target.scope_key
    and status = 'active'
    and id <> target.id;

  update listing_copy_benchmark_sets
  set status = 'active', activated_at = activated_time, retired_at = null
  where id = target.id;
end;
$$;

revoke all on function activate_listing_copy_benchmark_set(uuid) from public, anon, authenticated;
grant execute on function activate_listing_copy_benchmark_set(uuid) to service_role;
