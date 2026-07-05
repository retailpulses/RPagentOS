-- Product & Listing Intelligence: comprehensive schema migration
-- Creates the full canonical product + platform listing data model for MVP
-- Replaces the narrow Mercari-only alignment migration with the complete design
--
-- Tables created (15 new):
--   source_import_runs, source_import_rows, platform_accounts,
--   product_families, product_spus, product_assets,
--   merchandising_focus_items, product_commercials,
--   bundle_products, bundle_components,
--   platform_listing_skus, platform_listing_images,
--   platform_listing_attributes, platform_listing_price_tiers,
--   product_platform_links
--
-- Tables expanded (2 existing):
--   product_variants, platform_listings

-- ============================================================================
-- 1. IMPORT CONTROL TABLES
-- ============================================================================

create table if not exists source_import_runs (
  id uuid primary key default gen_random_uuid(),
  source_system text not null,
  platform text,
  shop_code text,
  source_file text not null,
  file_hash text,
  row_count integer,
  status text not null default 'running',
  started_at timestamptz default now(),
  finished_at timestamptz,
  metadata jsonb default '{}'::jsonb
);

create table if not exists source_import_rows (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references source_import_runs(id) on delete cascade,
  row_index integer not null,
  source_key text,
  row_hash text,
  raw_row jsonb not null,
  normalized_status text default 'pending',
  error_message text,
  created_at timestamptz default now(),
  unique(run_id, row_index)
);

-- ============================================================================
-- 2. PLATFORM ACCOUNTS
-- ============================================================================

create table if not exists platform_accounts (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  shop_code text not null,
  display_name text,
  seller_account_id text,
  status text default 'active',
  default_currency text default 'JPY',
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(platform, shop_code)
);

-- ============================================================================
-- 3. CANONICAL PRODUCT TABLES
-- ============================================================================

-- 3.1 Product Families (broader business series / strategic grouping)
create table if not exists product_families (
  id uuid primary key default gen_random_uuid(),
  family_code text,
  family_name text not null,
  category text,
  brand_name text,
  strategy_notes text,
  status text default 'active',
  raw_payload jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table product_families alter column family_code set not null;
create unique index if not exists ux_product_families_family_code
  on product_families(family_code);

create index if not exists ix_product_families_category
  on product_families(category);

create index if not exists ix_product_families_brand
  on product_families(brand_name);

-- 3.2 Product SPUs (SPU1 product model group under a Product Family)
create table if not exists product_spus (
  id uuid primary key default gen_random_uuid(),
  product_family_id uuid references product_families(id) on delete set null,
  spu_code text not null,
  title text not null,
  manufacturer_model text,
  category text,
  status text default 'active',
  raw_payload jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(spu_code)
);

create index if not exists ix_product_spus_family
  on product_spus(product_family_id);

create index if not exists ix_product_spus_manufacturer
  on product_spus(manufacturer_model);

create index if not exists ix_product_spus_category
  on product_spus(category);

-- 3.3 Expand product_variants into the canonical model
-- Keep existing columns; add canonical keys and raw_payload

alter table product_variants add column if not exists item_code text;
alter table product_variants add column if not exists shop_sku text;
alter table product_variants add column if not exists product_spu_id uuid references product_spus(id) on delete set null;
alter table product_variants add column if not exists material text;
alter table product_variants add column if not exists material_ja text;
alter table product_variants add column if not exists color_code text;
alter table product_variants add column if not exists country_of_origin_ja text;
alter table product_variants add column if not exists assembly_status text;
alter table product_variants add column if not exists package_width_cm numeric;
alter table product_variants add column if not exists package_height_cm numeric;
alter table product_variants add column if not exists package_length_cm numeric;
alter table product_variants add column if not exists package_weight_kg numeric;
alter table product_variants add column if not exists product_weight_kg numeric;
alter table product_variants add column if not exists package_quantity integer;
alter table product_variants add column if not exists raw_payload jsonb;
alter table product_variants add column if not exists updated_at timestamptz default now();

-- Mercari-export fields (from original alignment migration)
alter table product_variants add column if not exists jan_code text;
alter table product_variants add column if not exists catalog_id text;
alter table product_variants add column if not exists snapshot_id text;
alter table product_variants add column if not exists sku_type text;
alter table product_variants add column if not exists stock_qty integer default 0;

-- Indexes
create unique index if not exists ux_product_variants_item_code
  on product_variants(item_code)
  where item_code is not null;

create index if not exists ix_product_variants_shop_sku
  on product_variants(shop_sku);

create index if not exists ix_product_variants_spu
  on product_variants(product_spu_id);

-- 3.4 Product Assets (canonical product images/files, separate from listing images)
create table if not exists product_assets (
  id uuid primary key default gen_random_uuid(),
  product_family_id uuid references product_families(id) on delete cascade,
  product_spu_id uuid references product_spus(id) on delete cascade,
  variant_id uuid references product_variants(id) on delete cascade,
  asset_type text not null default 'image',
  asset_url text,
  asset_path text,
  position integer,
  source_system text,
  alt_text text,
  metadata jsonb default '{}'::jsonb,
  raw_payload jsonb,
  created_at timestamptz default now()
);

create index if not exists ix_product_assets_family
  on product_assets(product_family_id);

create index if not exists ix_product_assets_spu
  on product_assets(product_spu_id);

create index if not exists ix_product_assets_variant
  on product_assets(variant_id);

create index if not exists ix_product_assets_type
  on product_assets(asset_type);

-- 3.5 Merchandising Focus Items (hero/growth/seasonal/test/clearance at SPU level)
create table if not exists merchandising_focus_items (
  id uuid primary key default gen_random_uuid(),
  focus_type text not null default 'hero',
  product_spu_id uuid not null references product_spus(id) on delete cascade,
  priority integer not null default 100,
  reason text,
  strategy_note text,
  start_date date,
  end_date date,
  status text not null default 'active',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(focus_type, product_spu_id),
  check (focus_type in ('hero', 'growth', 'seasonal', 'test', 'clearance')),
  check (status in ('active', 'inactive', 'archived'))
);

-- 3.6 Product Commercials (costs, inventory, pricing targets — separate from descriptive identity)
create table if not exists product_commercials (
  variant_id uuid references product_variants(id) on delete cascade,
  source_available_qty integer,
  owned_qty integer,
  purchased_qty integer,
  presale_qty integer,
  source_unit_price numeric,
  discounted_unit_price numeric,
  fulfillment_fee numeric,
  effective_cost_price numeric,
  effective_tcogs numeric,
  amazon_target_price numeric,
  rakuten_target_price numeric,
  mercari_effective_price_excl_shipping numeric,
  mercari_effective_price_incl_shipping numeric,
  floor_price_incl_shipping numeric,
  ceiling_price_incl_shipping numeric,
  listing_readiness_score numeric,
  audit_notes text,
  inventory_status text,
  restock_date date,
  raw_payload jsonb,
  updated_at timestamptz default now(),
  primary key(variant_id)
);

-- 3.7 Bundle Products
create table if not exists bundle_products (
  id uuid primary key default gen_random_uuid(),
  bundle_code text not null,
  name text not null,
  bundle_type text not null,
  product_family_id uuid references product_families(id) on delete set null,
  product_spu_id uuid references product_spus(id) on delete set null,
  status text default 'active',
  metadata jsonb default '{}'::jsonb,
  raw_payload jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(bundle_code)
);

-- 3.8 Bundle Components
create table if not exists bundle_components (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid references bundle_products(id) on delete cascade,
  variant_id uuid references product_variants(id) on delete restrict,
  quantity integer not null default 1,
  component_role text,
  created_at timestamptz default now(),
  unique(bundle_id, variant_id, component_role)
);

-- ============================================================================
-- 4. PLATFORM LISTING TABLES
-- ============================================================================

-- 4.1 Expand platform_listings with shared marketplace columns

alter table platform_listings add column if not exists platform_account_id uuid references platform_accounts(id) on delete set null;
alter table platform_listings add column if not exists product_family_id uuid references product_families(id) on delete set null;
alter table platform_listings add column if not exists product_spu_id uuid references product_spus(id) on delete set null;
alter table platform_listings add column if not exists external_snapshot_id text;
alter table platform_listings add column if not exists manage_number text;
alter table platform_listings add column if not exists description text;
alter table platform_listings add column if not exists category_id text;
alter table platform_listings add column if not exists category_name text;
alter table platform_listings add column if not exists brand_id text;
alter table platform_listings add column if not exists condition_code text;
alter table platform_listings add column if not exists listing_status_code text;
alter table platform_listings add column if not exists currency text default 'JPY';
alter table platform_listings add column if not exists published_at timestamptz;
alter table platform_listings add column if not exists platform_updated_at timestamptz;
alter table platform_listings add column if not exists source_hash text;

-- Additional Mercari/Rakuten convenience columns
alter table platform_listings add column if not exists shipping_method text;
alter table platform_listings add column if not exists ship_from_region text;
alter table platform_listings add column if not exists shipping_days text;
alter table platform_listings add column if not exists shipping_paid_by text;
alter table platform_listings add column if not exists parent_group_id text;
alter table platform_listings add column if not exists parent_group_name text;
alter table platform_listings add column if not exists images text[];

-- Normalize existing listing_status column
alter table platform_listings alter column listing_status set default 'unknown';

-- Indexes
create index if not exists ix_platform_listings_account
  on platform_listings(platform_account_id);
create index if not exists ix_platform_listings_family
  on platform_listings(product_family_id);
create index if not exists ix_platform_listings_spu
  on platform_listings(product_spu_id);
create index if not exists ix_platform_listings_source_hash
  on platform_listings(source_hash);
create index if not exists ix_platform_listings_updated
  on platform_listings(platform_updated_at);
create index if not exists ix_platform_listings_normalized_status
  on platform_listings(listing_status);

-- 4.2 Platform Listing SKUs (marketplace SKU/offer/variant rows)
create table if not exists platform_listing_skus (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references platform_listings(id) on delete cascade,
  variant_id uuid references product_variants(id) on delete set null,
  sku_position integer not null default 1,
  external_sku_id text,
  external_snapshot_id text,
  seller_sku text,
  sku_code text,
  option_name_1 text,
  option_value_1 text,
  option_name_2 text,
  option_value_2 text,
  jan_code text,
  catalog_id text,
  asin text,
  current_price numeric(12,2),
  business_price numeric(12,2),
  stock_qty integer,
  stock_delta_flag text,
  stock_delta_qty integer,
  sku_status_code text,
  sku_status text default 'unknown',
  stock_status_code text,
  stock_status text default 'unknown',
  raw_payload jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(listing_id, sku_position)
);

create index if not exists ix_pl_skus_variant
  on platform_listing_skus(variant_id);
create index if not exists ix_pl_skus_sku_code
  on platform_listing_skus(sku_code);
create index if not exists ix_pl_skus_seller_sku
  on platform_listing_skus(seller_sku);
create index if not exists ix_pl_skus_asin
  on platform_listing_skus(asin);
create index if not exists ix_pl_skus_sku_status
  on platform_listing_skus(sku_status);

-- 4.3 Platform Listing Images (ordered per-listing images)
create table if not exists platform_listing_images (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references platform_listings(id) on delete cascade,
  image_position integer not null,
  image_url text,
  image_path text,
  image_name text,
  alt_text text,
  image_type text,
  registered_flag text,
  update_flag text,
  source text,
  raw_payload jsonb,
  created_at timestamptz default now(),
  unique(listing_id, image_position)
);

create index if not exists ix_pl_images_listing
  on platform_listing_images(listing_id);

-- 4.4 Platform Listing Attributes (channel-specific key/value/unit triples)
create table if not exists platform_listing_attributes (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references platform_listings(id) on delete cascade,
  sku_id uuid references platform_listing_skus(id) on delete cascade,
  attribute_position integer,
  attribute_key text not null,
  attribute_value text,
  attribute_unit text,
  source text,
  raw_payload jsonb,
  created_at timestamptz default now()
);

create index if not exists ix_pl_attrs_listing
  on platform_listing_attributes(listing_id);
create index if not exists ix_pl_attrs_sku
  on platform_listing_attributes(sku_id);
create index if not exists ix_pl_attrs_key
  on platform_listing_attributes(attribute_key);

-- 4.5 Platform Listing Price Tiers (Amazon business/quantity pricing)
create table if not exists platform_listing_price_tiers (
  id uuid primary key default gen_random_uuid(),
  listing_sku_id uuid references platform_listing_skus(id) on delete cascade,
  tier_type text not null,
  price_type text,
  lower_bound integer not null,
  price numeric(12,2),
  created_at timestamptz default now(),
  unique(listing_sku_id, tier_type, lower_bound)
);

create index if not exists ix_pl_tiers_sku
  on platform_listing_price_tiers(listing_sku_id);

-- ============================================================================
-- 5. CROSS-REFERENCE: PRODUCT-PLATFORM LINKS
-- ============================================================================

create table if not exists product_platform_links (
  id uuid primary key default gen_random_uuid(),
  product_family_id uuid references product_families(id) on delete cascade,
  product_spu_id uuid references product_spus(id) on delete cascade,
  variant_id uuid references product_variants(id) on delete cascade,
  bundle_id uuid references bundle_products(id) on delete cascade,
  listing_id uuid references platform_listings(id) on delete cascade,
  listing_sku_id uuid references platform_listing_skus(id) on delete cascade,
  platform text not null,
  shop_code text not null,
  match_method text not null,
  confidence numeric,
  created_at timestamptz default now(),
  unique(platform, shop_code, listing_id, listing_sku_id, product_family_id, product_spu_id, variant_id, bundle_id),
  check (
    product_family_id is not null
    or product_spu_id is not null
    or variant_id is not null
    or bundle_id is not null
  )
);

create index if not exists ix_ppl_variant
  on product_platform_links(variant_id);
create index if not exists ix_ppl_listing
  on product_platform_links(listing_id);
create index if not exists ix_ppl_listing_sku
  on product_platform_links(listing_sku_id);
create index if not exists ix_ppl_platform_shop
  on product_platform_links(platform, shop_code);

-- ============================================================================
-- 6. GRANT PERMISSIONS TO SUPABASE ROLES
-- ============================================================================

-- Tables created in this migration
do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'source_import_runs', 'source_import_rows',
      'platform_accounts',
      'product_families', 'product_spus', 'product_assets',
      'merchandising_focus_items', 'product_commercials',
      'bundle_products', 'bundle_components',
      'platform_listing_skus', 'platform_listing_images',
      'platform_listing_attributes', 'platform_listing_price_tiers',
      'product_platform_links'
    ])
  loop
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format('grant select, insert, update, delete on %I to service_role', t);
    execute format('grant select on %I to anon', t);
  end loop;
end
$$;
