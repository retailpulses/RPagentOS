-- Listing Intelligence Workbench MVP-0: work items table + target classification view
-- Follows the v0.3 execution spec model.
-- Dependencies: 20260706000000_product_listing_intelligence_schema.sql

-- ============================================================================
-- 1. LISTING WORK ITEMS
-- ============================================================================

create table if not exists listing_work_items (
  id uuid primary key default gen_random_uuid(),

  workflow_type text not null,
  issue_type text,
  recommended_action text,

  target_type text not null,
  target_id uuid not null,
  target_key text generated always as (
    workflow_type || ':' ||
    coalesce(platform, '') || ':' ||
    coalesce(shop_code, '') || ':' ||
    target_type || ':' ||
    target_id::text
  ) stored,

  platform text,
  shop_code text,
  product_family_id uuid references product_families(id) on delete set null,
  product_spu_id uuid references product_spus(id) on delete set null,
  variant_id uuid references product_variants(id) on delete set null,
  bundle_id uuid references bundle_products(id) on delete set null,
  listing_id uuid references platform_listings(id) on delete set null,
  listing_sku_id uuid references platform_listing_skus(id) on delete set null,

  priority_score numeric not null default 0,
  business_priority text not null default 'normal',
  issue_severity text not null default 'medium',

  is_hero boolean not null default false,
  hero_scope text,
  hero_priority integer,
  hero_reason text,
  target_platforms text[] default array[]::text[],
  listing_strategy_status text,

  human_input_level text not null default 'confirm_only',
  status text not null default 'open',
  assigned_to text,

  source_context jsonb not null default '{}'::jsonb,
  source_snapshot_hash text,
  source_snapshot_version integer not null default 1,
  classification_reasons jsonb not null default '[]'::jsonb,
  deterministic_findings jsonb not null default '[]'::jsonb,
  latest_result_id uuid,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  unique(target_key),
  check (workflow_type in (
    'audit_existing_listing',
    'optimize_hero_listing',
    'prepare_batch_listing',
    'review_batch_listing'
  )),
  check (issue_type is null or issue_type in (
    'missing_mapping',
    'missing_sku_row',
    'missing_images',
    'unknown_status',
    'price_missing',
    'price_stock_mismatch',
    'title_quality',
    'content_gap',
    'hero_platform_gap',
    'manual_review'
  )),
  check (recommended_action is null or recommended_action in (
    'ignore',
    'create_task',
    'run_qwen_review',
    'create_image_task',
    'create_mapping_task',
    'create_price_task',
    'request_human_brief',
    'add_to_future_batch'
  )),
  check (target_type in (
    'product_family',
    'product_spu',
    'variant',
    'bundle',
    'listing',
    'listing_sku'
  )),
  check (business_priority in ('low', 'normal', 'high', 'critical')),
  check (issue_severity in ('low', 'medium', 'high', 'critical')),
  check (hero_scope is null or hero_scope in ('product_family', 'product_spu', 'variant', 'bundle')),
  check (human_input_level in ('none', 'confirm_only', 'brief_required', 'batch_brief_required', 'expert_review_required')),
  check (status in ('open', 'in_progress', 'waiting_for_input', 'ready_for_review', 'approved', 'ignored', 'task_created', 'closed', 'stale'))
);

-- Indexes
create index if not exists idx_lwi_platform on listing_work_items(platform);
create index if not exists idx_lwi_shop_code on listing_work_items(shop_code);
create index if not exists idx_lwi_workflow_type on listing_work_items(workflow_type);
create index if not exists idx_lwi_issue_type on listing_work_items(issue_type);
create index if not exists idx_lwi_status on listing_work_items(status);
create index if not exists idx_lwi_priority on listing_work_items(priority_score desc);
create index if not exists idx_lwi_is_hero on listing_work_items(is_hero) where is_hero = true;
create index if not exists idx_lwi_listing_id on listing_work_items(listing_id);
create index if not exists idx_lwi_listing_sku_id on listing_work_items(listing_sku_id);
create index if not exists idx_lwi_product_spu_id on listing_work_items(product_spu_id);
create index if not exists idx_lwi_created_at on listing_work_items(created_at desc);

-- ============================================================================
-- 2. TARGET CLASSIFICATION VIEW v1
-- ============================================================================

-- Drop first to allow create or replace
drop view if exists listing_target_classification_v1;

create view listing_target_classification_v1 as

-- ─── 2.1 Missing mapping: platform_listings without product_platform_links ───
select
  'listing'::text as target_type,
  pl.id as target_id,
  'audit_existing_listing'::text as workflow_type,
  'missing_mapping'::text as issue_type,
  'create_mapping_task'::text as recommended_action,
  pl.platform,
  pl.shop_code,
  pl.product_family_id,
  pl.product_spu_id,
  null::uuid as variant_id,
  null::uuid as bundle_id,
  pl.id as listing_id,
  null::uuid as listing_sku_id,
  false as is_hero,
  null::text as hero_scope,
  null::integer as hero_priority,
  null::text as hero_reason,
  null::text[] as target_platforms,
  null::text as listing_strategy_status,
  case when pl.listing_status = 'active' then 'high'::text else 'normal'::text end as business_priority,
  case when pl.listing_status = 'active' then 'high'::text else 'medium'::text end as issue_severity,
  'unresolved'::text as mapping_status,
  pl.listing_status,
  null::text as stock_status,
  null::text as image_status,
  null::text as content_status,
  null::text as price_status,
  'confirm_only'::text as human_input_level,
  jsonb_build_object(
    'external_listing_id', pl.external_listing_id,
    'title', pl.title,
    'listing_status', pl.listing_status,
    'platform', pl.platform,
    'shop_code', pl.shop_code
  ) as source_context,
  null::text as source_snapshot_hash,
  jsonb_build_array(
    jsonb_build_object('reason', 'No product_platform_links entry for this listing', 'check', 'missing_mapping')
  ) as classification_reasons,
  50::numeric as priority_score
from platform_listings pl
left join product_platform_links ppl on ppl.listing_id = pl.id
where ppl.id is null
  and pl.platform is not null
  and pl.platform != ''

union all

-- ─── 2.2 Missing mapping: platform_listing_skus without product_platform_links ───
select
  'listing_sku'::text as target_type,
  pls.id as target_id,
  'audit_existing_listing'::text as workflow_type,
  'missing_mapping'::text as issue_type,
  'create_mapping_task'::text as recommended_action,
  pl.platform,
  pl.shop_code,
  pl.product_family_id,
  pl.product_spu_id,
  pls.variant_id,
  null::uuid as bundle_id,
  pls.listing_id,
  pls.id as listing_sku_id,
  false as is_hero,
  null::text as hero_scope,
  null::integer as hero_priority,
  null::text as hero_reason,
  null::text[] as target_platforms,
  null::text as listing_strategy_status,
  case when pl.listing_status = 'active' then 'high'::text else 'normal'::text end as business_priority,
  case when pl.listing_status = 'active' then 'high'::text else 'medium'::text end as issue_severity,
  'unresolved'::text as mapping_status,
  pl.listing_status,
  pls.stock_status,
  null::text as image_status,
  null::text as content_status,
  case when pls.current_price is null then 'missing'::text else 'present'::text end as price_status,
  'confirm_only'::text as human_input_level,
  jsonb_build_object(
    'external_listing_id', pl.external_listing_id,
    'title', pl.title,
    'sku_position', pls.sku_position,
    'seller_sku', pls.seller_sku,
    'sku_code', pls.sku_code,
    'asin', pls.asin,
    'listing_status', pl.listing_status,
    'platform', pl.platform,
    'shop_code', pl.shop_code
  ) as source_context,
  null::text as source_snapshot_hash,
  jsonb_build_array(
    jsonb_build_object('reason', 'No product_platform_links entry for this listing SKU', 'check', 'missing_mapping')
  ) as classification_reasons,
  50::numeric as priority_score
from platform_listing_skus pls
join platform_listings pl on pl.id = pls.listing_id
left join product_platform_links ppl on ppl.listing_sku_id = pls.id
where ppl.id is null

union all

-- ─── 2.3 Active listing with zero stock ───
select
  'listing_sku'::text as target_type,
  pls.id as target_id,
  'audit_existing_listing'::text as workflow_type,
  'price_stock_mismatch'::text as issue_type,
  'create_task'::text as recommended_action,
  pl.platform,
  pl.shop_code,
  pl.product_family_id,
  pl.product_spu_id,
  pls.variant_id,
  null::uuid as bundle_id,
  pls.listing_id,
  pls.id as listing_sku_id,
  false as is_hero,
  null::text as hero_scope,
  null::integer as hero_priority,
  null::text as hero_reason,
  null::text[] as target_platforms,
  null::text as listing_strategy_status,
  'high'::text as business_priority,
  'high'::text as issue_severity,
  'resolved'::text as mapping_status,
  pl.listing_status,
  'zero_stock'::text as stock_status,
  null::text as image_status,
  null::text as content_status,
  case when pls.current_price is null then 'missing'::text else 'present'::text end as price_status,
  'confirm_only'::text as human_input_level,
  jsonb_build_object(
    'external_listing_id', pl.external_listing_id,
    'title', pl.title,
    'sku_position', pls.sku_position,
    'seller_sku', pls.seller_sku,
    'stock_qty', pls.stock_qty,
    'current_price', pls.current_price,
    'platform', pl.platform,
    'shop_code', pl.shop_code
  ) as source_context,
  null::text as source_snapshot_hash,
  jsonb_build_array(
    jsonb_build_object('reason', 'Active listing SKU has zero stock', 'check', 'zero_stock')
  ) as classification_reasons,
  70::numeric as priority_score
from platform_listing_skus pls
join platform_listings pl on pl.id = pls.listing_id
where pl.listing_status = 'active'
  and pls.stock_qty = 0

union all

-- ─── 2.4 Missing images: active listings with no listing images ───
select
  'listing'::text as target_type,
  pl.id as target_id,
  'audit_existing_listing'::text as workflow_type,
  'missing_images'::text as issue_type,
  'create_image_task'::text as recommended_action,
  pl.platform,
  pl.shop_code,
  pl.product_family_id,
  pl.product_spu_id,
  null::uuid as variant_id,
  null::uuid as bundle_id,
  pl.id as listing_id,
  null::uuid as listing_sku_id,
  false as is_hero,
  null::text as hero_scope,
  null::integer as hero_priority,
  null::text as hero_reason,
  null::text[] as target_platforms,
  null::text as listing_strategy_status,
  case when pl.listing_status = 'active' then 'high'::text else 'normal'::text end as business_priority,
  'high'::text as issue_severity,
  null::text as mapping_status,
  pl.listing_status,
  null::text as stock_status,
  'missing'::text as image_status,
  null::text as content_status,
  null::text as price_status,
  'confirm_only'::text as human_input_level,
  jsonb_build_object(
    'external_listing_id', pl.external_listing_id,
    'title', pl.title,
    'image_count', 0,
    'platform', pl.platform,
    'shop_code', pl.shop_code
  ) as source_context,
  null::text as source_snapshot_hash,
  jsonb_build_array(
    jsonb_build_object('reason', 'Active listing has no images', 'check', 'missing_images')
  ) as classification_reasons,
  65::numeric as priority_score
from platform_listings pl
left join platform_listing_images pli on pli.listing_id = pl.id
where pli.id is null
  and pl.listing_status = 'active'

union all

-- ─── 2.5 Unknown listing status ───
select
  'listing'::text as target_type,
  pl.id as target_id,
  'audit_existing_listing'::text as workflow_type,
  'unknown_status'::text as issue_type,
  'create_task'::text as recommended_action,
  pl.platform,
  pl.shop_code,
  pl.product_family_id,
  pl.product_spu_id,
  null::uuid as variant_id,
  null::uuid as bundle_id,
  pl.id as listing_id,
  null::uuid as listing_sku_id,
  false as is_hero,
  null::text as hero_scope,
  null::integer as hero_priority,
  null::text as hero_reason,
  null::text[] as target_platforms,
  null::text as listing_strategy_status,
  'normal'::text as business_priority,
  'medium'::text as issue_severity,
  null::text as mapping_status,
  coalesce(pl.listing_status, 'null') as listing_status,
  null::text as stock_status,
  null::text as image_status,
  null::text as content_status,
  null::text as price_status,
  'confirm_only'::text as human_input_level,
  jsonb_build_object(
    'external_listing_id', pl.external_listing_id,
    'title', pl.title,
    'listing_status_code', pl.listing_status_code,
    'platform', pl.platform,
    'shop_code', pl.shop_code
  ) as source_context,
  null::text as source_snapshot_hash,
  jsonb_build_array(
    jsonb_build_object('reason', 'Listing has unknown or null status', 'check', 'unknown_status', 'value', coalesce(pl.listing_status, 'null'))
  ) as classification_reasons,
  30::numeric as priority_score
from platform_listings pl
where pl.listing_status = 'unknown'
   or pl.listing_status is null

union all

-- ─── 2.6 Missing price: active listing SKUs with no current_price ───
select
  'listing_sku'::text as target_type,
  pls.id as target_id,
  'audit_existing_listing'::text as workflow_type,
  'price_missing'::text as issue_type,
  'create_price_task'::text as recommended_action,
  pl.platform,
  pl.shop_code,
  pl.product_family_id,
  pl.product_spu_id,
  pls.variant_id,
  null::uuid as bundle_id,
  pls.listing_id,
  pls.id as listing_sku_id,
  false as is_hero,
  null::text as hero_scope,
  null::integer as hero_priority,
  null::text as hero_reason,
  null::text[] as target_platforms,
  null::text as listing_strategy_status,
  case when pl.listing_status = 'active' then 'high'::text else 'normal'::text end as business_priority,
  'high'::text as issue_severity,
  null::text as mapping_status,
  pl.listing_status,
  null::text as stock_status,
  null::text as image_status,
  null::text as content_status,
  'missing'::text as price_status,
  'confirm_only'::text as human_input_level,
  jsonb_build_object(
    'external_listing_id', pl.external_listing_id,
    'title', pl.title,
    'sku_position', pls.sku_position,
    'seller_sku', pls.seller_sku,
    'current_price', pls.current_price,
    'listing_status', pl.listing_status,
    'platform', pl.platform,
    'shop_code', pl.shop_code
  ) as source_context,
  null::text as source_snapshot_hash,
  jsonb_build_array(
    jsonb_build_object('reason', 'Active listing SKU has no price set', 'check', 'price_missing')
  ) as classification_reasons,
  75::numeric as priority_score
from platform_listing_skus pls
join platform_listings pl on pl.id = pls.listing_id
where (pls.current_price is null or pls.current_price = 0)
  and pl.listing_status = 'active'

union all

-- ─── 2.7 Hero SPU strategic work items ───
select
  'product_spu'::text as target_type,
  mfi.product_spu_id as target_id,
  'optimize_hero_listing'::text as workflow_type,
  null::text as issue_type,
  'request_human_brief'::text as recommended_action,
  null::text as platform,
  null::text as shop_code,
  ps.product_family_id,
  mfi.product_spu_id,
  null::uuid as variant_id,
  null::uuid as bundle_id,
  null::uuid as listing_id,
  null::uuid as listing_sku_id,
  true as is_hero,
  'product_spu'::text as hero_scope,
  mfi.priority as hero_priority,
  mfi.reason as hero_reason,
  coalesce(hp.target_platforms, array[]::text[]) as target_platforms,
  null::text as listing_strategy_status,
  'high'::text as business_priority,
  'medium'::text as issue_severity,
  null::text as mapping_status,
  null::text as listing_status,
  null::text as stock_status,
  null::text as image_status,
  null::text as content_status,
  null::text as price_status,
  'brief_required'::text as human_input_level,
  jsonb_build_object(
    'spu_code', ps.spu_code,
    'title', ps.title,
    'focus_type', mfi.focus_type,
    'priority', mfi.priority,
    'reason', mfi.reason,
    'strategy_note', mfi.strategy_note
  ) as source_context,
  null::text as source_snapshot_hash,
  jsonb_build_array(
    jsonb_build_object('reason', coalesce(mfi.reason, 'Hero product requires listing strategy'), 'check', 'hero_spu')
  ) as classification_reasons,
  90::numeric as priority_score
from merchandising_focus_items mfi
join product_spus ps on ps.id = mfi.product_spu_id
left join lateral (
  select array_agg(distinct ppl.platform) as target_platforms
  from product_platform_links ppl
  where ppl.product_spu_id = mfi.product_spu_id
    and ppl.platform is not null
) hp on true
where mfi.focus_type = 'hero'
  and mfi.status = 'active';

-- ============================================================================
-- 3. GRANT PERMISSIONS
-- ============================================================================

grant select, insert, update, delete on listing_work_items to authenticated;
grant select, insert, update, delete on listing_work_items to service_role;
grant select, update on listing_work_items to anon;

grant select on listing_target_classification_v1 to authenticated;
grant select on listing_target_classification_v1 to service_role;
grant select on listing_target_classification_v1 to anon;
