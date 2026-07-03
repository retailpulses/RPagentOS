# RPagentOS — Supabase MVP Schema & Development Task

## 0. Objective

Build a new repository named `RPagentOS`.

This is **not** an incremental extension of the existing `boutique-listing` repo.

The master business database for RPagentOS is **Supabase / Postgres**.

Existing systems such as Boutique Listing, Baserow, Cloudflare D1, KV, R2, Mercari relay, Rakuten adapter, and Amazon adapter should be treated as **source systems, integration systems, or legacy capability areas**, not as the canonical Agent OS database.

The goal of RPagentOS MVP is to create a canonical business data layer and agent workflow layer for:

1. Product master normalization
2. Listing audit and optimization
3. Bundle / combo product growth
4. Promotion planning
5. Agent decision/action auditability

---

## 1. Repository Target

Create / work in a new repository:

```text
RPagentOS
```

Recommended stack for MVP:

```text
Frontend: Next.js or lightweight React app
Backend/API: Next.js API routes, Hono, or Fastify
Database: Supabase Postgres
Auth: Supabase Auth or simple admin-only auth for MVP
ORM: Drizzle or Prisma
Jobs: cron/worker layer, can start as scripts
Integrations: Boutique Listing, Baserow, Mercari, Rakuten, Amazon as adapters
```

Do not assume Cloudflare D1 is the master database.
D1 can remain a cache or legacy source for Boutique Listing only.

---

## 2. Existing Systems Context

### 2.1 Boutique Listing Repo

Boutique Listing currently contains useful product/listing capabilities.
It should be treated as an existing capability area and data source.

Existing Boutique Listing data entities include:

#### Baserow Product Master

Table: `886994 — Product Master`

Source of truth today for product data.

Fields include:

- Identity: Item Code, SPU1, SPU1 Name, Shop SKU, Baserow Row ID
- Pricing: Unit Price, Discounted Price, Effective Pricing, Cost Price, Manual Cost Price, Std TCOGS, Effective TCOGS, MAP, Floor Price, Ceiling Price
- Inventory: Qty Available, Owned Qty, Unit Fulfillment Fee
- Classification: Mercari Category ID, Internal Category Name, Product Genre-key, Rakuten Genre, Listing Readiness Score
- Descriptive: Product Name, Main Color, Main Material, Features, Specification, Product Main Image, Image URLs JSON
- Operational: Manual Presale Arrival Date, 30D Sales, More On The Way, Estimated Next Arrival Date, Inventory Status, Store Name, Stock Coverage Days

#### Boutique Listing KV Namespace

Namespace: `BOUTIQUE_LISTING`

Important keys:

```text
hero-products
products:{code}:config-current
products:{code}:benchmark-summary
products:{code}:listing-snapshot
products:{code}:memos
baserow:{code}
products:{code}:platforms:amazon:draft-current
products:{code}:platforms:rakuten:draft-current
products:{code}:platforms:rakuten:snapshot
products:{code}:platforms:amazon:primary-mapping
```

#### Boutique Listing D1 Database

Database: `BOUTIQUE_DB`

Existing tables:

```text
product_master
config_log
keyword_pool
image_items
competitor_listings
amazon_drafts
amazon_listing_mappings
rakuten_drafts
rakuten_mappings
bundle_products
```

#### R2 Images

Bucket: `BOUTIQUE_IMAGES`

Stores product images as opaque objects keyed by path, for example:

```text
N508P301428A/1718123456_abc.jpg
```

#### Amazon Listings Baserow Table

Table: `907027 — Amazon Listings`

Read-only via Amazon adapter.

Fields include SKU, fulfillment channel, quantity, pricing, sale dates, shipping template, etc.

---

## 3. Critical Design Direction

RPagentOS must not copy the old system blindly.

The new system should use Supabase as the canonical layer.

Recommended data layering:

```text
Source Layer
- Baserow Product Master
- Boutique Listing D1
- Boutique Listing KV
- R2 Images
- Mercari snapshots
- Rakuten snapshots
- Amazon listings/drafts

Canonical Layer in Supabase
- suppliers
- product_groups
- products_spu1
- product_variants
- bundle_products
- bundle_components
- platform_listings
- platform_listing_snapshots
- image_items
- keyword_pool

Intelligence Layer in Supabase
- listing_score_snapshots
- competitor_listings
- product_benchmarks
- promotion_candidates
- bundle_opportunities

Execution Layer in Supabase
- platform_listing_drafts
- promotion_campaigns
- promotion_targets
- agent_actions

Audit Layer in Supabase
- agent_runs
- event_log
- approval_tasks
```

---

## 4. Domain Definitions

### 4.1 SKU / Item Code

Smallest sellable or inventory unit.

Example:

```text
N508P301428A
```

### 4.2 SPU1

Parent product within one supplier.
Usually groups simple variations such as color or size.

Example:

```text
SPU1: N508P301428
- SKU: N508P301428A
- SKU: N508P301428B
```

Rule:

```text
One SPU1 belongs to one supplier.
```

### 4.3 Product Group

Previously discussed as SPU2.
This is not a supply-chain parent SKU.
It is an operational merchandising group, similar to Mercari category or Amazon product type.

Example:

```text
鋼製物置
ダイニングチェア
スーツケース
ロフトベッド
```

A product group can contain many SPU1s and may cut across suppliers.

Use the database name:

```text
product_groups
```

Do not name this table `spu2`.

### 4.4 Bundle / Combo Product

A sellable product composed of multiple units.

It may be:

1. Multiple units of the same SKU
2. Multiple different SKUs from the same SPU1
3. Multiple products across different SPU1s
4. Products across different suppliers

Bundle / combo is a critical growth strategy and must be treated as a first-class product entity.

Examples:

```text
CHAIR-A x 2
TABLE-A x 1 + CHAIR-B x 4
BED-FRAME x 1 + MATTRESS x 1
```

### 4.5 Hero Product vs Hero Listing

Hero product is a product strategy decision.
Hero listing is a platform/listing-level execution decision.

Both must exist.

Examples:

```text
A product may be a hero product.
Its Mercari listing may be hero.
Its Rakuten listing may still be weak or draft.
```

---

## 5. MVP Supabase Schema

Use Postgres tables in Supabase.
Use UUID primary keys unless there is a strong reason not to.
Use `created_at` and `updated_at` on all canonical tables.
Use JSONB for flexible fields, but do not hide relational data inside JSONB when it needs querying.

---

## 5.1 suppliers

```sql
create table suppliers (
  id uuid primary key default gen_random_uuid(),
  supplier_code text unique not null,
  supplier_name text not null,
  source_type text,
  status text not null default 'active',
  lead_time_days integer,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

---

## 5.2 product_groups

```sql
create table product_groups (
  id uuid primary key default gen_random_uuid(),
  group_code text unique not null,
  group_name text not null,
  platform_category_hint text,
  amazon_product_type text,
  mercari_category_id text,
  rakuten_genre text,
  group_strategy text,
  is_priority_group boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

---

## 5.3 products_spu1

```sql
create table products_spu1 (
  id uuid primary key default gen_random_uuid(),
  spu1_code text unique not null,
  spu1_name text,
  supplier_id uuid references suppliers(id),
  product_group_id uuid references product_groups(id),

  lifecycle_status text not null default 'active',
  is_hero_product boolean not null default false,
  hero_rank integer,
  hero_reason text,

  listing_readiness_score numeric,
  internal_category_name text,
  product_genre_key text,
  mercari_category_id text,
  rakuten_genre text,

  main_material text,
  main_color text,
  features_json jsonb,
  specification_json jsonb,

  source_system text,
  source_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

---

## 5.4 product_variants

```sql
create table product_variants (
  id uuid primary key default gen_random_uuid(),
  item_code text unique not null,
  spu1_id uuid references products_spu1(id),
  supplier_id uuid references suppliers(id),
  product_group_id uuid references product_groups(id),

  shop_sku text,
  baserow_row_id text,
  product_name text,
  main_color text,
  main_material text,

  unit_price numeric,
  discounted_price numeric,
  effective_price numeric,
  cost_price numeric,
  manual_cost_price numeric,
  std_tcogs numeric,
  effective_tcogs numeric,
  map_price numeric,
  floor_price numeric,
  ceiling_price numeric,

  qty_available integer,
  owned_qty integer,
  unit_fulfillment_fee numeric,
  inventory_status text,
  stock_coverage_days numeric,
  more_on_the_way boolean,
  manual_presale_arrival_date date,
  estimated_next_arrival_date date,
  sales_30d numeric,

  listing_readiness_score numeric,
  product_main_image_url text,
  image_urls_json jsonb,

  store_name text,
  status text not null default 'active',
  source_system text,
  source_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

---

## 5.5 bundle_products

```sql
create table bundle_products (
  id uuid primary key default gen_random_uuid(),
  bundle_sku text unique not null,
  bundle_name text not null,
  bundle_type text not null,
  product_group_id uuid references product_groups(id),
  primary_spu1_id uuid references products_spu1(id),
  primary_supplier_id uuid references suppliers(id),

  bundle_strategy text,
  lifecycle_status text not null default 'draft',
  is_hero_product boolean not null default false,
  hero_rank integer,
  hero_reason text,

  total_component_cost numeric,
  total_component_tcogs numeric,
  total_component_price numeric,
  suggested_bundle_price numeric,
  final_price numeric,
  discount_percentage numeric,
  margin_amount numeric,
  margin_rate numeric,

  inventory_calc_method text not null default 'min_component_qty',
  available_bundle_qty integer,
  reserved_bundle_qty integer,

  listing_readiness_score numeric,
  notes text,
  source_system text,
  source_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Bundle type examples:

```text
same_sku_multi_unit
mixed_sku
cross_spu1
cross_supplier
set
upsell_pack
clearance_combo
```

---

## 5.6 bundle_components

```sql
create table bundle_components (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid not null references bundle_products(id) on delete cascade,
  component_type text not null default 'sku',
  component_sku_id uuid references product_variants(id),
  component_bundle_id uuid references bundle_products(id),
  component_item_code text,
  quantity integer not null default 1,
  role text,
  supplier_id uuid references suppliers(id),
  cost_price numeric,
  tcogs numeric,
  price_contribution numeric,
  inventory_required boolean not null default true,
  sort_order integer,
  created_at timestamptz not null default now()
);
```

Do not only store bundle components in JSON.
JSON can be kept as an import compatibility field, but the relational component table is required.

---

## 5.7 platform_listings

```sql
create table platform_listings (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  shop_code text not null,
  external_listing_id text,
  external_sku_or_item_code text,

  listing_entity_type text not null,
  sku_id uuid references product_variants(id),
  spu1_id uuid references products_spu1(id),
  bundle_id uuid references bundle_products(id),
  product_group_id uuid references product_groups(id),

  listing_title text,
  listing_description text,
  listing_status text,
  listing_url text,

  current_price numeric,
  regular_price numeric,
  sale_price numeric,
  floor_price numeric,
  ceiling_price numeric,
  margin_amount numeric,
  margin_rate numeric,

  listing_score numeric,
  score_grade text,
  score_updated_at timestamptz,

  is_hero_listing boolean not null default false,
  listing_tier text not null default 'normal',
  listing_intent text,
  parent_listing_id uuid references platform_listings(id),

  image_count integer,
  main_image_url text,
  has_square_main_image boolean,
  has_size_image boolean,
  has_usage_image boolean,
  has_bundle_explanation_image boolean,
  has_bad_image_flag boolean,

  seo_keyword_status text,
  price_status text,
  stock_status text,
  sync_status text,

  source_system text,
  raw_source_json jsonb,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(platform, shop_code, external_listing_id)
);
```

Listing entity type examples:

```text
sku
spu1
bundle
returned_alias
```

Listing tier examples:

```text
hero
normal
mess
clearance
test
bundle
returned
duplicate
```

Listing intent examples:

```text
main_listing
alias_listing
returned_item
bundle_listing
duplicate
test
```

---

## 5.8 platform_listing_snapshots

```sql
create table platform_listing_snapshots (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references platform_listings(id) on delete cascade,
  platform text not null,
  shop_code text not null,
  external_listing_id text,
  title text,
  description text,
  price numeric,
  category_json jsonb,
  shipping_json jsonb,
  status text,
  images_json jsonb,
  stock_status text,
  listing_url text,
  raw_snapshot_json jsonb,
  captured_at timestamptz not null default now()
);
```

---

## 5.9 listing_score_snapshots

```sql
create table listing_score_snapshots (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references platform_listings(id) on delete cascade,
  total_score numeric not null,

  title_score numeric,
  image_score numeric,
  description_score numeric,
  price_score numeric,
  stock_score numeric,
  seo_score numeric,
  compliance_score numeric,
  conversion_score numeric,

  bundle_clarity_score numeric,
  component_accuracy_score numeric,
  margin_safety_score numeric,

  grade text,
  risk_level text,
  recommended_action text,

  model_name text,
  scoring_version text not null,
  input_hash text,
  explanation_json jsonb,
  created_by_agent_run_id uuid,
  created_at timestamptz not null default now()
);
```

After inserting a score snapshot, update `platform_listings.listing_score`, `score_grade`, and `score_updated_at`.

---

## 5.10 image_items

```sql
create table image_items (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid,
  item_code text,
  bundle_sku text,
  listing_id uuid references platform_listings(id),
  image_id text,
  url text not null,
  r2_key text,
  role text,
  sort_order integer,
  excluded boolean not null default false,
  quality_score numeric,
  agent_notes text,
  created_at timestamptz not null default now()
);
```

Image role examples:

```text
main
variant
size
feature
bundle_explanation
component_layout
lifestyle
comparison
```

---

## 5.11 keyword_pool

```sql
create table keyword_pool (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid,
  item_code text,
  bundle_sku text,
  product_group_id uuid references product_groups(id),
  platform text,
  keyword text not null,
  type text,
  priority integer,
  status text not null default 'active',
  source text,
  notes text,
  sort_score numeric,
  created_at timestamptz not null default now()
);
```

Keyword type examples:

```text
core
feature
material
size
style
seasonal
negative
```

---

## 5.12 competitor_listings

```sql
create table competitor_listings (
  id uuid primary key default gen_random_uuid(),
  record_id text,
  entity_type text,
  entity_id uuid,
  item_code text,
  bundle_sku text,
  product_group_id uuid references product_groups(id),
  url text,
  platform text,
  title text,
  price numeric,
  shipping_fee numeric,
  total_price numeric,
  image_url text,
  description text,
  notes text,
  fetched_at timestamptz
);
```

---

## 5.13 promotion_candidates

```sql
create table promotion_candidates (
  id uuid primary key default gen_random_uuid(),
  candidate_type text not null,
  platform text,
  shop_code text,

  listing_id uuid references platform_listings(id),
  sku_id uuid references product_variants(id),
  spu1_id uuid references products_spu1(id),
  bundle_id uuid references bundle_products(id),
  product_group_id uuid references product_groups(id),

  current_price numeric,
  suggested_price numeric,
  suggested_discount_type text,
  suggested_discount_value numeric,
  suggested_campaign_type text,

  reason_code text,
  reason_text text,

  bundle_component_risk text,
  inventory_constraint_json jsonb,
  margin_before numeric,
  margin_after numeric,
  expected_sales_lift numeric,

  confidence_score numeric,
  risk_level text,
  recommended_action text,

  status text not null default 'new',
  reviewed_by text,
  reviewed_at timestamptz,
  created_by_agent_run_id uuid,
  created_at timestamptz not null default now()
);
```

Candidate type examples:

```text
returned_stock
low_score_listing
overstock
seasonal
price_gap
hero_boost
bundle_growth
bundle_clearance
```

---

## 5.14 promotion_campaigns

```sql
create table promotion_campaigns (
  id uuid primary key default gen_random_uuid(),
  campaign_name text not null,
  platform text,
  shop_code text,
  campaign_type text not null,
  campaign_scope text,
  status text not null default 'draft',

  start_at timestamptz,
  end_at timestamptz,
  timezone text default 'Asia/Tokyo',

  discount_type text,
  discount_value numeric,
  min_order_amount numeric,
  budget_limit numeric,
  expected_gmv numeric,
  expected_margin_impact numeric,

  created_by text,
  approved_by text,
  approval_status text default 'pending',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Campaign type examples:

```text
coupon
timesale
clearance
returned_stock
seasonal
manual
bundle_growth
```

---

## 5.15 promotion_targets

```sql
create table promotion_targets (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references promotion_campaigns(id) on delete cascade,
  target_type text not null,
  target_id uuid,
  platform_listing_id uuid references platform_listings(id),

  before_price numeric,
  proposed_price numeric,
  after_discount_price numeric,
  expected_margin numeric,
  expected_margin_rate numeric,

  target_status text not null default 'included',
  exclusion_reason text,
  created_at timestamptz not null default now()
);
```

Target type examples:

```text
listing
sku
spu1
bundle
product_group
shop
```

---

## 5.16 bundle_opportunities

```sql
create table bundle_opportunities (
  id uuid primary key default gen_random_uuid(),
  opportunity_type text not null,
  product_group_id uuid references product_groups(id),
  primary_sku_id uuid references product_variants(id),
  proposed_bundle_name text,
  proposed_components_json jsonb,
  suggested_price numeric,
  estimated_cost numeric,
  estimated_margin numeric,
  inventory_fit_score numeric,
  demand_fit_score numeric,
  operational_complexity_score numeric,
  risk_level text,
  reason_text text,
  status text not null default 'proposed',
  created_by_agent_run_id uuid,
  created_at timestamptz not null default now()
);
```

---

## 5.17 platform_listing_drafts

```sql
create table platform_listing_drafts (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  shop_code text,
  entity_type text not null,
  entity_id uuid,
  item_code text,
  bundle_sku text,

  external_sku_or_manage_number text,
  draft_status text not null default 'draft',
  title text,
  description text,
  price numeric,
  category_json jsonb,
  attributes_json jsonb,
  images_json jsonb,
  shipping_json jsonb,
  raw_draft_json jsonb,

  source text,
  version integer not null default 1,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

---

## 5.18 agent_runs

```sql
create table agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null,
  agent_version text,
  task_type text not null,
  trigger_type text,
  trigger_user text,
  status text not null default 'running',
  input_scope_json jsonb,
  output_summary_json jsonb,
  error_summary text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
```

---

## 5.19 agent_actions

```sql
create table agent_actions (
  id uuid primary key default gen_random_uuid(),
  agent_run_id uuid references agent_runs(id),
  action_type text not null,
  platform text,
  shop_code text,
  entity_type text,
  entity_id uuid,

  before_state_json jsonb,
  after_state_json jsonb,
  execution_status text not null default 'pending',
  external_request_json jsonb,
  external_response_json jsonb,
  error_message text,

  executed_by text,
  executed_at timestamptz,
  created_at timestamptz not null default now()
);
```

Every external change must create an `agent_actions` record.
Every action must preserve `before_state_json` where available.

---

## 5.20 event_log

```sql
create table event_log (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid,
  item_code text,
  bundle_sku text,
  event_type text not null,
  event_source text,
  payload_json jsonb,
  agent_run_id uuid references agent_runs(id),
  created_at timestamptz not null default now()
);
```

---

## 6. Required Indexes

Create indexes for common Agent OS access patterns.

```sql
create index idx_product_variants_item_code on product_variants(item_code);
create index idx_product_variants_spu1_id on product_variants(spu1_id);
create index idx_product_variants_product_group_id on product_variants(product_group_id);

create index idx_products_spu1_spu1_code on products_spu1(spu1_code);
create index idx_products_spu1_product_group_id on products_spu1(product_group_id);
create index idx_products_spu1_is_hero on products_spu1(is_hero_product);

create index idx_bundle_products_bundle_sku on bundle_products(bundle_sku);
create index idx_bundle_products_group_id on bundle_products(product_group_id);
create index idx_bundle_products_is_hero on bundle_products(is_hero_product);
create index idx_bundle_components_bundle_id on bundle_components(bundle_id);
create index idx_bundle_components_sku_id on bundle_components(component_sku_id);

create index idx_platform_listings_platform_shop on platform_listings(platform, shop_code);
create index idx_platform_listings_entity on platform_listings(listing_entity_type, sku_id, bundle_id);
create index idx_platform_listings_score on platform_listings(listing_score);
create index idx_platform_listings_tier on platform_listings(listing_tier);
create index idx_platform_listings_hero on platform_listings(is_hero_listing);

create index idx_listing_score_snapshots_listing_id on listing_score_snapshots(listing_id);
create index idx_listing_score_snapshots_created_at on listing_score_snapshots(created_at desc);

create index idx_promotion_candidates_status on promotion_candidates(status);
create index idx_promotion_candidates_type on promotion_candidates(candidate_type);
create index idx_promotion_candidates_listing_id on promotion_candidates(listing_id);
create index idx_promotion_candidates_bundle_id on promotion_candidates(bundle_id);

create index idx_agent_runs_task_status on agent_runs(task_type, status);
create index idx_agent_actions_agent_run_id on agent_actions(agent_run_id);
create index idx_event_log_entity on event_log(entity_type, entity_id);
```

---

## 7. Baserow Product Master Mapping

Implement a sync adapter that maps Baserow Product Master into Supabase.

Mapping:

```text
Item Code                   -> product_variants.item_code
SPU1                        -> products_spu1.spu1_code
SPU1 Name                   -> products_spu1.spu1_name
Shop SKU                    -> product_variants.shop_sku
Baserow Row ID              -> product_variants.baserow_row_id

Unit Price                  -> product_variants.unit_price
Discounted Price            -> product_variants.discounted_price
Effective Pricing           -> product_variants.effective_price
Cost Price                  -> product_variants.cost_price
Manual Cost Price           -> product_variants.manual_cost_price
Std TCOGS                   -> product_variants.std_tcogs
Effective TCOGS             -> product_variants.effective_tcogs
MAP                         -> product_variants.map_price
Floor Price                 -> product_variants.floor_price
Ceiling Price               -> product_variants.ceiling_price

Qty Available               -> product_variants.qty_available
Owned Qty                   -> product_variants.owned_qty
Unit Fulfillment Fee        -> product_variants.unit_fulfillment_fee

Mercari Category ID         -> products_spu1.mercari_category_id
Internal Category Name      -> products_spu1.internal_category_name
Product Genre-key           -> products_spu1.product_genre_key
Rakuten Genre               -> products_spu1.rakuten_genre
Listing Readiness Score     -> products_spu1.listing_readiness_score and/or product_variants.listing_readiness_score

Product Name                -> product_variants.product_name
Main Color                  -> product_variants.main_color
Main Material               -> product_variants.main_material
Features                    -> products_spu1.features_json
Specification               -> products_spu1.specification_json
Product Main Image          -> product_variants.product_main_image_url
Image URLs JSON             -> product_variants.image_urls_json

Manual Presale Arrival Date -> product_variants.manual_presale_arrival_date
30D Sales                   -> product_variants.sales_30d
More On The Way             -> product_variants.more_on_the_way
Estimated Next Arrival Date -> product_variants.estimated_next_arrival_date
Inventory Status            -> product_variants.inventory_status
Store Name                  -> product_variants.store_name
Stock Coverage Days         -> product_variants.stock_coverage_days
```

Important distinction:

```text
Baserow Listing Readiness Score = product data readiness
platform_listings.listing_score = real platform listing quality score
```

Do not merge these two concepts.

---

## 8. Boutique Listing Migration / Integration Rules

### Rule 1

Do not drop or rewrite existing Boutique Listing systems during RPagentOS MVP.

### Rule 2

Treat Boutique Listing D1 as a source system or capability source, not as the RPagentOS master database.

### Rule 3

Treat KV as cache/legacy state.
Migrate important long-lived state into Supabase.

Recommended migration targets:

```text
KV hero-products                          -> Supabase hero strategy fields / future hero_product_registry
KV products:{code}:config-current         -> platform_listing_drafts or future listing_configs
KV products:{code}:benchmark-summary      -> future product_benchmarks
KV products:{code}:listing-snapshot       -> platform_listing_snapshots
KV products:{code}:memos                  -> future entity_memos
KV platform draft-current                 -> platform_listing_drafts
D1 keyword_pool                           -> keyword_pool
D1 image_items                            -> image_items
D1 competitor_listings                    -> competitor_listings
D1 bundle_products                        -> bundle_products + bundle_components
D1 config_log                             -> event_log
```

---

## 9. MVP Agent Capabilities

### 9.1 Product Canonicalization

The system should be able to display one canonical view for an `item_code` or `bundle_sku`:

```text
product facts
pricing
inventory
images
keywords
SPU1
product group
platform listings
listing snapshots
listing score
promotion candidates
agent actions
```

### 9.2 Listing Audit

The system should score platform listings.

Listing score must include:

```text
title_score
image_score
description_score
price_score
stock_score
seo_score
compliance_score
conversion_score
```

For bundle listings also include:

```text
bundle_clarity_score
component_accuracy_score
margin_safety_score
```

### 9.3 Bundle Growth Engine

The system should support:

```text
same SKU multi-unit bundles
mixed SKU bundles
cross-SPU1 bundles
cross-supplier bundles
bundle inventory calculation
bundle listing draft generation
bundle promotion candidates
```

### 9.4 Promotion Planning

Promotion candidates must support:

```text
returned stock
coupons
shop-level timesale
product-level promotion
bundle promotion
hero product boost
low-score listing optimization
```

### 9.5 Agent Auditability

Every agent run must be recorded.
Every execution action must be auditable.
No silent platform updates.

Minimum audit chain:

```text
agent_runs
  -> listing_score_snapshots / promotion_candidates / platform_listing_drafts
  -> agent_actions
  -> event_log
```

---

## 10. Development Tasks

### Task 1: Initialize RPagentOS Repo

Create basic project structure:

```text
RPagentOS/
  apps/
    web/
  packages/
    db/
    core/
    integrations/
    agents/
  scripts/
  docs/
```

Acceptable alternative for MVP:

```text
RPagentOS/
  src/
    db/
    core/
    integrations/
    agents/
    web/
  scripts/
  docs/
```

Do not over-engineer monorepo if it slows MVP.

---

### Task 2: Supabase Schema Migration

Create the first migration for the MVP tables listed in section 5.

Required tables:

```text
suppliers
product_groups
products_spu1
product_variants
bundle_products
bundle_components
platform_listings
platform_listing_snapshots
listing_score_snapshots
image_items
keyword_pool
competitor_listings
promotion_candidates
promotion_campaigns
promotion_targets
bundle_opportunities
platform_listing_drafts
agent_runs
agent_actions
event_log
```

---

### Task 3: TypeScript Models

Create typed models for all tables.

If using Drizzle, define schema in:

```text
packages/db/schema.ts
```

If using Prisma, define schema in:

```text
packages/db/prisma/schema.prisma
```

Prefer explicit enums or string union types in TypeScript for:

```text
platform
listing_entity_type
listing_tier
listing_intent
bundle_type
candidate_type
campaign_type
agent task_type
agent action_type
```

---

### Task 4: Baserow Sync Adapter Skeleton

Create a sync adapter skeleton:

```text
integrations/baserow/productMasterSync.ts
```

It should:

1. Fetch or accept Baserow Product Master rows
2. Upsert suppliers if needed
3. Upsert product_groups if enough category data exists
4. Upsert products_spu1 by SPU1
5. Upsert product_variants by Item Code
6. Write event_log records

For MVP, mocked input is acceptable.
Do not require live credentials in the first implementation.

---

### Task 5: Bundle Import / Upsert Logic

Create bundle upsert logic:

```text
core/bundles/upsertBundle.ts
```

It should support:

```text
same SKU multi-unit bundle
mixed SKU bundle
cross-SPU1 bundle
cross-supplier bundle
```

It must write both:

```text
bundle_products
bundle_components
```

Do not store components only in JSON.

---

### Task 6: Listing Score Snapshot Logic

Create a service:

```text
core/listingScore/createListingScoreSnapshot.ts
```

It should:

1. Insert into `listing_score_snapshots`
2. Update latest score fields on `platform_listings`
3. Write event_log

---

### Task 7: Agent Run / Action Logging

Create helper functions:

```text
core/agents/startAgentRun.ts
core/agents/completeAgentRun.ts
core/agents/logAgentAction.ts
```

Every agent process must use these helpers.

---

### Task 8: Smoke Tests

Add smoke tests or scripts for:

```text
1. Create supplier/product group/SPU1/SKU
2. Create same-SKU bundle
3. Create mixed-SKU bundle
4. Create platform listing for SKU
5. Create platform listing for bundle
6. Create listing score snapshot
7. Create promotion candidate
8. Create agent run and agent action
```

---

## 11. MVP UI Expectations

MVP UI can be simple.

Required views:

### Product / SKU View

Show:

```text
item_code
SPU1
product group
pricing
inventory
images
keywords
platform listings
latest listing score
promotion candidates
```

### Bundle View

Show:

```text
bundle_sku
bundle components
component quantities
component costs
calculated margin
available bundle qty
related listings
listing score
promotion candidates
```

### Listing Audit View

Show:

```text
listing title
platform
shop
listing score
score breakdown
recommended action
hero/mess/bundle/returned flags
```

### Agent Run View

Show:

```text
agent name
task type
status
input scope
output summary
actions taken
errors
```

---

## 12. Non-Goals for First MVP

Do not implement full platform execution yet.

Out of scope for first schema MVP:

```text
Automatic Mercari update execution
Automatic Rakuten update execution
Automatic Amazon update execution
Full coupon/timesale platform API integration
Full approval workflow UI
Full image generation pipeline
Full competitor scraper
Full RBAC
Full multi-tenant design
```

But the schema must not block these future capabilities.

---

## 13. Acceptance Criteria

The implementation is acceptable when:

1. RPagentOS repo exists or the project structure is initialized.
2. Supabase migration creates all MVP tables.
3. Product, SPU1, product group, SKU, bundle, bundle component, platform listing, listing score, promotion candidate, agent run, and agent action can be inserted.
4. Bundle components are relational, not JSON-only.
5. A listing can represent a SKU, bundle, or returned alias.
6. Listing score latest value is stored on `platform_listings`, while history is stored in `listing_score_snapshots`.
7. Agent actions store before/after JSON.
8. Baserow Product Master mapping is documented in code or adapter comments.
9. Boutique Listing is treated as a source/capability system, not the canonical database.
10. No existing Boutique Listing table is dropped or destructively modified.

---

## 14. Important Warnings for the Coding Agent

Do not assume D1 is the master database.
Do not build Agent OS as a Boutique Listing submodule.
Do not hide bundle components only in JSON.
Do not merge product readiness score with platform listing score.
Do not allow agent execution without audit records.
Do not silently update external platforms.
Do not overbuild UI before schema and smoke tests are working.

---

## 15. Suggested First Commit Scope

The safest first commit should include only:

```text
1. Project skeleton
2. Supabase database schema migration
3. TypeScript schema/types
4. Seed/smoke script inserting sample SKU, bundle, listing, score, promotion candidate, agent run, and agent action
5. README explaining architecture and source-system boundaries
```

After that, continue with Baserow sync adapter and Boutique Listing integration.
