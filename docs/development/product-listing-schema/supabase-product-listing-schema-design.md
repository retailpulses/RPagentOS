# Supabase Product and Listing Intelligence Schema Design

Date: 2026-07-05
Revision: 2026-07-06
Status: Finalized for MVP Supabase implementation

Source files reviewed:

- `data/product and listings/export - Products - Grid.csv`
- `data/product and listings/mercari shop4 listing.csv`
- `data/product and listings/export - Rakuten listings - Grid (1).csv`
- `data/product and listings/amazon_open_listings_lite.tsv`

## Design Principles

1. Define business objects before table names.

   RPagentOS must distinguish Product Family, Product SPU / SPU1, Product Variant / SKU, Platform Listing SKU / Offer, Platform Listing, Bundle, Asset, and Merchandising Focus. Agents need this vocabulary to make correct decisions: audit a listing, optimize a SKU, compare coverage for a family, prioritize a hero SPU, or generate a bundle listing.

2. Canonical product data and marketplace listing data must be separate.

   Product master fields such as item code, SPU, supplier cost, package size, material, source inventory, and platform pricing targets belong to canonical product tables. Mercari, Rakuten, and Amazon export fields belong to platform listing tables. Do not let one marketplace export shape become the product master.

3. Keep Product Family and SPU separate.

   A Product Family is the broader business series or strategic grouping. `SPU1` is a product model group inside that family and belongs in `product_spus.spu_code`, not directly on `product_families`. A family can contain many SPU1 groups.

4. Preserve raw source exports losslessly.

   Every import should store the original row in `raw_payload jsonb`, the source file name, row index, import run ID, and source hash. Normalized fields are for querying and operations; raw payload is for audit, re-import, debugging, and future fields not yet modeled.

5. Normalize repeated slots into child tables.

   Mercari has up to 10 SKU slots and 20 image slots. Rakuten has up to 20 image slots and many attribute pairs. These should not become `image_1 ... image_20` or `sku_1 ... sku_10` columns in the main listing table. Use child tables with `position`.

6. Use stable internal keys, but retain platform IDs.

   Internal IDs should be UUIDs. External IDs such as Mercari `商品ID`, Rakuten `商品管理番号（商品URL）`, Rakuten `SKU管理番号`, Amazon `seller-sku`, and Amazon `product-id` must be stored as first-class fields and protected with platform-scoped unique indexes.

7. Treat `item code` as the canonical internal variant key.

   Product master `item code` is the strongest internal sellable-unit key. `Shop SKU` is operational/shop-facing and not globally unique, so it should not be the primary product variant identity.

8. Support both variant-level and listing-level SKU truth.

   `product_variants` should represent internal sellable variants. Marketplace SKU records should live in `platform_listing_skus` because each channel uses different SKU identifiers, option labels, stock semantics, and flat-file structures.

9. Make `product_platform_links` the authoritative mapping.

   A platform listing can represent one variant, multiple variants, a marketplace variation group, a whole SPU, or a bundle. `platform_listings.product_family_id` and `platform_listings.product_spu_id` can exist as convenience/cache fields, but authoritative mapping between internal family/SPU/variant/bundle objects and platform listing SKUs must live in `product_platform_links`.

10. Model bundles early.

   Bundle and combo listings are a core business strategy, not an edge case. Same-SKU multipacks, chair sets, table-and-chair sets, and mixed-color bundles should be modeled with `bundle_products` and `bundle_components`, not hidden in listing titles.

11. Model product assets separately from listing images.

   Product images are core to listing optimization. Canonical product/source images should live in `product_assets`; channel-specific listing images remain in `platform_listing_images`.

12. Model Hero Product as merchandising strategy, not product identity.

   Hero Product is usually managed at the SPU1 level. Do not make `product_spus.is_hero` the primary design. Use `merchandising_focus_items` so hero/growth/seasonal/test/clearance focus can carry priority, reason, strategy note, active period, and status.

13. Use platform accounts, not only free-text platform/shop fields.

   `platform` and `shop_code` are useful denormalized fields, but production imports and operator workflows should also reference `platform_accounts` so account configuration, channel credentials, and shop metadata have a home.

14. Treat channel pricing and inventory as operational snapshots.

   Product master pricing targets, source inventory, and channel listing prices are related but not identical. Store current channel export values on the listing/SKU records and keep import snapshots so price/inventory changes can be detected.

15. Keep the schema operator-first.

   The MVP needs to answer: What is listed where? What product does it map to? Is title/description/image/price/stock healthy? What changed since the last import? What needs human review?

16. Make import idempotency explicit.

   Imports should upsert by stable platform keys, not by row order. Re-running the same CSV should not duplicate products, listings, images, or SKU rows.

17. Constrain normalized status values.

   Keep raw platform status codes in raw fields, but use constrained normalized statuses such as `active`, `inactive`, `draft`, `sold_out`, `suppressed`, `unknown`, and `archived` for agent/operator workflows.

## Required Terminology

### Product Family

A Product Family is the broader business-level product series or strategic grouping. A family may include multiple `SPU1` product model groups.

Examples:

- Outdoor storage boxes
- Outdoor sheds
- Chair series
- Cat tower series

A family can contain multiple SPUs, such as 118L storage box, 170L storage box, 270L storage box, and 300L storage box. In this design, `product_families` is not the SPU table.

### Product SPU / SPU1

A Product SPU is the product model group under a Product Family. In the current product master, `SPU1` identifies this level.

Interpretation:

- `SPU1` -> `product_spus.spu_code`
- `SPU2（メーカー型番）` -> `product_spus.manufacturer_model`

`SPU2（メーカー型番）` should be treated as a manufacturer model or secondary grouping reference. Hero Product status is usually managed at this SPU1 level through `merchandising_focus_items`, not on the whole family and not on each individual color/SKU.

### SKU / Product Variant

A SKU or Product Variant is the concrete sellable unit under a Product SPU.

In this business context:

- `item code` is the canonical internal variant key.
- `Shop SKU` is an operational/shop-facing identifier and is not globally unique.

A variant can represent one color, one size, one supplier item code, one package configuration, or one concrete sellable unit.

Example:

```text
Product Family: Outdoor storage boxes
Product SPUs / SPU1:
  - 118L storage box
  - 170L storage box
  - 270L storage box
  - 300L storage box
Product Variants:
  - 300L Brown
  - 300L Black
  - 170L Brown
  - 170L Black
```

### Marketplace Listing

A Marketplace Listing is a channel-specific representation of a product family, variant, bundle, or offer.

Examples:

- Mercari Shop4 listing
- Rakuten item page
- Amazon offer row
- Future Yahoo/Qoo10 listing

A listing can represent one SKU, multiple SKUs, a color variation group, a bundle/combo product, or a marketplace-specific offer. Therefore listing data must remain separate from canonical product data.

### Relationship Model

The simple hierarchy is:

```text
Product Family
  -> Product SPU / SPU1
  -> Product Variant / SKU
  -> Platform Listing SKU / Offer
  -> Platform Listing
```

Operationally, listing relationships are not always one-to-one. The more accurate model is:

```text
product_families
  has many product_spus

product_spus
  has many product_variants
  may be marked as hero/growth/seasonal/test through merchandising_focus_items

product_variants
  maps to platform_listing_skus through product_platform_links

platform_listings
  has many platform_listing_skus
  has many platform_listing_images
  has many platform_listing_attributes

product_families, product_spus, product_variants, and bundle_products
  link to platform_listing_skus through product_platform_links
```

`product_platform_links` is the source of truth for mapping internal product/variant/bundle objects to marketplace listings and listing SKUs.

## Source Data Findings

### Product Master

File: `export - Products - Grid.csv`

- Rows: 5,572
- Columns: 136
- Important identity fields:
  - `id`
  - `item code`
  - `Shop SKU`
  - `SPU1`
  - `SPU2（メーカー型番）`
  - `UUID`
- Important operational fields:
  - `Product Name`
  - `Qty Available`
  - `Mercari Qty`
  - `Amazon pricing`
  - `Rakuten pricing`
  - `Mercari category ID`
  - `Rakuten Genre`
  - `Rakuten manageNumber`
  - `RakutenSKU`
  - `Mercari Shop4 Product ID`
  - `Image URLs JSON`
  - `Platform_Attributes_JSON`
  - package/assembled size, weight, material, color, readiness, audit notes

Observed shape:

- `item code` is nearly unique and is the strongest internal variant key.
- `SPU1` groups variants into product SPUs, which can then be assigned to broader product families.
- `Shop SKU` is not unique; it repeats across many rows.
- Product master already contains platform hints, but those should be treated as cross-reference and target data, not as live listing truth.

### Mercari Shop4 Listing Export

File: `mercari shop4 listing.csv`

- Rows: 5,208
- Columns: 178
- Main listing key: `商品ID`
- Listing fields:
  - `スナップショットID`
  - `商品名`
  - `商品説明`
  - `販売価格`
  - `カテゴリID`
  - `商品の状態`
  - `配送方法`
  - `発送元の地域`
  - `発送までの日数`
  - `配送料の負担`
  - `送料ID`
  - `商品ステータス`
  - `商品グループID`
  - `商品グループ名`
  - `商品登録日時`
  - `最終更新日時`
  - `Hash`
- Repeating SKU slots:
  - `SKU1_*` through `SKU10_*`
  - Most rows have 1 SKU.
  - Some rows have 2-5 SKUs.
- Repeating image slots:
  - `商品画像名_1` through `商品画像名_20`
  - `商品画像更新フラグ_1` through `_20`
  - `商品画像登録有無_1` through `_20`
  - Image names are empty in this file, but registration flags are populated.

Observed shape:

- Mercari export is listing-first, with embedded SKU slots.
- `商品ID` should map to `platform_listings.external_listing_id`.
- `SKUx_商品管理コード` is the best bridge back to product master `item code` when populated.
- `Hash` can support change detection.

### Rakuten Listing Export

File: `export - Rakuten listings - Grid (1).csv`

- Rows: 1,582
- Columns: 578
- Main item key:
  - `商品管理番号（商品URL）`
- SKU key:
  - `SKU管理番号`
  - `システム連携用SKU番号`
- Listing fields:
  - `商品番号`
  - `商品名`
  - `ジャンルID`
  - `PC用商品説明文`
  - `スマートフォン用商品説明文`
  - `PC用販売説明文`
- SKU/offer fields:
  - `通常購入販売価格`
  - `表示価格`
  - `在庫数`
  - `在庫戻しフラグ`
  - `在庫切れ時の注文受付`
  - `送料`
- Repeating image slots:
  - `商品画像タイプ1..20`
  - `商品画像パス1..20`
  - `商品画像名（ALT）1..20`
- Repeating product attributes:
  - `商品属性（項目）1..42`
  - `商品属性（値）1..42`
  - `商品属性（単位）...`

Observed shape:

- Rakuten export mixes item-level rows and SKU rows.
- `商品管理番号（商品URL）` repeats across SKU variants and should identify the platform listing/item.
- `SKU管理番号` identifies platform SKU rows.
- Attribute pairs must be normalized, not widened.

### Amazon Open Listings Lite

File: `amazon_open_listings_lite.tsv`

- Rows: 87
- Columns: 24
- Main SKU key:
  - `seller-sku`
- Amazon catalog key:
  - `product-id` (ASIN-like)
- Listing/offer fields:
  - `quantity`
  - `price`
  - `Business Price`
  - `standard-price-point`
- Business pricing tiers:
  - `Quantity Price Type`
  - `Quantity Lower Bound 1..5`
  - `Quantity Price 1..5`
  - progressive price fields, currently mostly empty

Observed shape:

- Amazon file is offer/SKU-level, not product-content-level.
- It does not contain title, description, images, or category.
- Business price tiers should be child records, not columns on the main listing.

## Proposed Data Model

### 1. Import Control Tables

#### `source_import_runs`

Tracks every source file import.

Key columns:

- `id uuid primary key`
- `source_system text not null` -- `product_master`, `mercari`, `rakuten`, `amazon`
- `platform text`
- `shop_code text`
- `source_file text not null`
- `file_hash text`
- `row_count integer`
- `status text not null default 'running'`
- `started_at timestamptz default now()`
- `finished_at timestamptz`
- `metadata jsonb default '{}'::jsonb`

#### `source_import_rows`

Lossless row-level staging and audit.

Key columns:

- `id uuid primary key`
- `run_id uuid references source_import_runs(id) on delete cascade`
- `row_index integer not null`
- `source_key text`
- `row_hash text`
- `raw_row jsonb not null`
- `normalized_status text default 'pending'`
- `error_message text`
- `created_at timestamptz default now()`
- `unique(run_id, row_index)`

### 2. Canonical Product Tables

#### `product_families`

Broad product-series or strategic grouping.

Recommended columns:

- `id uuid primary key`
- `family_code text`
- `family_name text not null`
- `category text`
- `brand_name text`
- `strategy_notes text`
- `status text default 'active'`
- `raw_payload jsonb`
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()`

Indexes:

- `unique(family_code)` where `family_code is not null`
- `index(category)`
- `index(brand_name)`

#### `product_spus`

Product model group under a Product Family. This is the `SPU1` level and the normal level for Hero Product management.

Recommended columns:

- `id uuid primary key`
- `product_family_id uuid references product_families(id) on delete set null`
- `spu_code text not null` -- from `SPU1`
- `title text not null`
- `manufacturer_model text` -- from `SPU2（メーカー型番）`
- `category text`
- `status text default 'active'`
- `raw_payload jsonb`
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()`

Indexes:

- `unique(spu_code)`
- `index(product_family_id)`
- `index(manufacturer_model)`
- `index(category)`

#### `product_variants`

Internal sellable SKU/item-code truth under a Product SPU.

Recommended columns:

- `id uuid primary key`
- `product_spu_id uuid references product_spus(id) on delete set null`
- `item_code text not null` -- product master `item code`
- `sku text` -- backward-compatible alias during migration; do not use as the new canonical key
- `shop_sku text` -- product master `Shop SKU`
- `variant_name text`
- `color text`
- `color_code text`
- `size_text text`
- `material text`
- `material_ja text`
- `country_of_origin_ja text`
- `assembly_status text`
- `package_width_cm numeric`
- `package_height_cm numeric`
- `package_length_cm numeric`
- `package_weight_kg numeric`
- `product_weight_kg numeric`
- `package_quantity integer`
- `status text default 'active'`
- `raw_payload jsonb`
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()`

Indexes:

- `unique(item_code)`
- `index(sku)`
- `index(shop_sku)`
- `index(product_spu_id)`

#### `product_assets`

Canonical product/source assets independent from marketplace listing images. Assets can be scoped to a family, SPU, variant, or a combination depending on how specific the image or resource is.

Recommended columns:

- `id uuid primary key`
- `product_family_id uuid references product_families(id) on delete cascade`
- `product_spu_id uuid references product_spus(id) on delete cascade`
- `variant_id uuid references product_variants(id) on delete cascade`
- `asset_type text not null` -- `image`, `manual`, `video`, `resource_pack`, `other`
- `asset_url text`
- `asset_path text`
- `position integer`
- `source_system text`
- `alt_text text`
- `metadata jsonb default '{}'::jsonb`
- `raw_payload jsonb`
- `created_at timestamptz default now()`

Indexes:

- `index(product_family_id)`
- `index(product_spu_id)`
- `index(variant_id)`
- `index(asset_type)`

#### `merchandising_focus_items`

Business strategy and prioritization layer for hero/growth/seasonal/test/clearance focus. Hero Product is managed here at the SPU level.

Recommended columns:

- `id uuid primary key`
- `focus_type text not null default 'hero'`
- `product_spu_id uuid not null references product_spus(id) on delete cascade`
- `priority integer not null default 100`
- `reason text`
- `strategy_note text`
- `start_date date`
- `end_date date`
- `status text not null default 'active'`
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()`
- `unique(focus_type, product_spu_id)`

Check constraints:

- `focus_type in ('hero', 'growth', 'seasonal', 'test', 'clearance')`
- `status in ('active', 'inactive', 'archived')`

Why separate:

- `product_spus` is canonical product structure.
- `merchandising_focus_items` is business strategy and prioritization.
- A simple `product_spus.is_hero` flag cannot represent priority, reason, active period, status, or future focus types.

#### `product_commercials`

Costs, supplier inventory, pricing targets, and readiness are change-prone. Keep them separate from descriptive product identity.

Recommended columns:

- `variant_id uuid references product_variants(id) on delete cascade`
- `source_available_qty integer`
- `owned_qty integer`
- `purchased_qty integer`
- `presale_qty integer`
- `source_unit_price numeric`
- `discounted_unit_price numeric`
- `fulfillment_fee numeric`
- `effective_cost_price numeric`
- `effective_tcogs numeric`
- `amazon_target_price numeric`
- `rakuten_target_price numeric`
- `mercari_effective_price_excl_shipping numeric`
- `mercari_effective_price_incl_shipping numeric`
- `floor_price_incl_shipping numeric`
- `ceiling_price_incl_shipping numeric`
- `listing_readiness_score numeric`
- `audit_notes text`
- `inventory_status text`
- `restock_date date`
- `raw_payload jsonb`
- `updated_at timestamptz default now()`
- `primary key(variant_id)`

#### `bundle_products`

First-class bundle/combo product definitions.

Recommended columns:

- `id uuid primary key`
- `bundle_code text not null`
- `name text not null`
- `bundle_type text not null` -- `same_sku_multipack`, `multi_variant_set`, `mixed_bundle`, `channel_only_bundle`
- `product_family_id uuid references product_families(id) on delete set null`
- `product_spu_id uuid references product_spus(id) on delete set null`
- `status text default 'active'`
- `metadata jsonb default '{}'::jsonb`
- `raw_payload jsonb`
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()`
- `unique(bundle_code)`

#### `bundle_components`

Constituent internal variants for a bundle.

Recommended columns:

- `id uuid primary key`
- `bundle_id uuid references bundle_products(id) on delete cascade`
- `variant_id uuid references product_variants(id) on delete restrict`
- `quantity integer not null default 1`
- `component_role text`
- `created_at timestamptz default now()`
- `unique(bundle_id, variant_id, component_role)`

### 3. Platform Listing Tables

#### `platform_accounts`

Marketplace account/shop identity and configuration.

Recommended columns:

- `id uuid primary key`
- `platform text not null`
- `shop_code text not null`
- `display_name text`
- `seller_account_id text`
- `status text default 'active'`
- `default_currency text default 'JPY'`
- `metadata jsonb default '{}'::jsonb`
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()`
- `unique(platform, shop_code)`

#### `platform_listings`

One marketplace listing/item page.

Recommended columns:

- `id uuid primary key`
- `platform_account_id uuid references platform_accounts(id) on delete set null`
- `platform text not null` -- `mercari`, `rakuten`, `amazon`
- `shop_code text not null` -- `shop4`, `rakuten_homebliss`, `amazon_jp`, etc.
- `product_family_id uuid references product_families(id) on delete set null` -- optional convenience only
- `product_spu_id uuid references product_spus(id) on delete set null` -- optional convenience only
- `external_listing_id text not null`
- `external_snapshot_id text`
- `manage_number text`
- `title text`
- `description text`
- `url text`
- `category_id text`
- `category_name text`
- `brand_id text`
- `condition_code text`
- `listing_status_code text` -- raw platform value
- `listing_status text` -- normalized RPagentOS value: `active`, `inactive`, `draft`, `sold_out`, `deleted`, `unknown`
- `current_price numeric(12,2)`
- `currency text default 'JPY'`
- `stock_qty integer`
- `published_at timestamptz`
- `platform_updated_at timestamptz`
- `source_hash text`
- `raw_payload jsonb`
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()`

Indexes:

- `unique(platform, shop_code, external_listing_id)`
- `index(platform_account_id)`
- `index(platform, shop_code)`
- `index(product_family_id)`
- `index(product_spu_id)`
- `index(source_hash)`
- `index(platform_updated_at)`

Platform mappings:

- Mercari `商品ID` -> `external_listing_id`
- Rakuten `商品管理番号（商品URL）` -> `external_listing_id` and `manage_number`
- Amazon `seller-sku` can become both listing external key and SKU key if no separate offer/listing ID exists.

Important:

- `platform_listings.product_family_id` is not authoritative.
- `platform_listings.product_spu_id` is also not authoritative.
- These fields are only denormalized conveniences for search and display.
- Authoritative mapping belongs in `product_platform_links`.

#### `platform_listing_skus`

One marketplace SKU/offer/variant row for a listing.

Recommended columns:

- `id uuid primary key`
- `listing_id uuid references platform_listings(id) on delete cascade`
- `variant_id uuid references product_variants(id) on delete set null`
- `sku_position integer default 1`
- `external_sku_id text`
- `external_snapshot_id text`
- `seller_sku text`
- `sku_code text`
- `option_name_1 text`
- `option_value_1 text`
- `option_name_2 text`
- `option_value_2 text`
- `jan_code text`
- `catalog_id text`
- `asin text`
- `current_price numeric(12,2)`
- `business_price numeric(12,2)`
- `stock_qty integer`
- `stock_delta_flag text`
- `stock_delta_qty integer`
- `sku_status_code text` -- raw platform SKU/offer status, when available
- `sku_status text` -- normalized SKU/offer status
- `stock_status_code text` -- raw stock signal, when available
- `stock_status text` -- normalized value: `in_stock`, `low_stock`, `out_of_stock`, `unknown`
- `raw_payload jsonb`
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()`

Indexes:

- `unique(listing_id, sku_position)`
- `unique(platform, shop_code, seller_sku)` should be exposed through a generated denormalized column or enforced in importer logic if not stored here.
- `index(variant_id)`
- `index(sku_code)`
- `index(seller_sku)`
- `index(asin)`

Platform mappings:

- Mercari `SKUx_ID` -> `external_sku_id`
- Mercari `SKUx_商品管理コード` -> `sku_code`
- Rakuten `SKU管理番号` -> `seller_sku`
- Rakuten `システム連携用SKU番号` -> `sku_code`
- Amazon `seller-sku` -> `seller_sku` and `sku_code`
- Amazon `product-id` -> `asin`

#### `platform_listing_images`

Ordered listing images.

Recommended columns:

- `id uuid primary key`
- `listing_id uuid references platform_listings(id) on delete cascade`
- `image_position integer not null`
- `image_url text`
- `image_path text`
- `image_name text`
- `alt_text text`
- `image_type text`
- `registered_flag text`
- `update_flag text`
- `source text`
- `raw_payload jsonb`
- `created_at timestamptz default now()`
- `unique(listing_id, image_position)`

Platform mappings:

- Product master `Image URLs JSON` -> `image_url`
- Mercari `商品画像名_x`, `商品画像登録有無_x`, `商品画像更新フラグ_x`
- Rakuten `商品画像タイプx`, `商品画像パスx`, `商品画像名（ALT）x`

#### `platform_listing_attributes`

Flexible channel-specific attributes.

Recommended columns:

- `id uuid primary key`
- `listing_id uuid references platform_listings(id) on delete cascade`
- `sku_id uuid references platform_listing_skus(id) on delete cascade`
- `attribute_position integer`
- `attribute_key text not null`
- `attribute_value text`
- `attribute_unit text`
- `source text`
- `raw_payload jsonb`
- `created_at timestamptz default now()`

Indexes:

- `index(listing_id)`
- `index(sku_id)`
- `index(attribute_key)`

Platform mappings:

- Rakuten `商品属性（項目）x`, `商品属性（値）x`, `商品属性（単位）x`
- Product master `Product Attribute Values`, `Platform_Attributes_JSON`
- Amazon tier fields should use a separate pricing table, not this table.

#### `platform_listing_price_tiers`

Amazon business/quantity pricing.

Recommended columns:

- `id uuid primary key`
- `listing_sku_id uuid references platform_listing_skus(id) on delete cascade`
- `tier_type text not null` -- `quantity`, `progressive`
- `price_type text` -- `fixed`, `percent`
- `lower_bound integer not null`
- `price numeric(12,2)`
- `created_at timestamptz default now()`
- `unique(listing_sku_id, tier_type, lower_bound)`

Platform mappings:

- Amazon `Quantity Lower Bound x`, `Quantity Price x`
- Amazon `Progressive Lower Bound x`, `Progressive Price x`

### 4. Cross-Reference Tables

#### `product_platform_links`

Authoritative mapping between internal product-family/SPU/variant/bundle objects and platform listing/listing-SKU objects.

Recommended columns:

- `id uuid primary key`
- `product_family_id uuid references product_families(id) on delete cascade`
- `product_spu_id uuid references product_spus(id) on delete cascade`
- `variant_id uuid references product_variants(id) on delete cascade`
- `bundle_id uuid references bundle_products(id) on delete cascade`
- `listing_id uuid references platform_listings(id) on delete cascade`
- `listing_sku_id uuid references platform_listing_skus(id) on delete cascade`
- `platform text not null`
- `shop_code text not null`
- `match_method text not null` -- `item_code`, `product_master_platform_id`, `manual`, `title_match`
- `confidence numeric`
- `created_at timestamptz default now()`
- `unique(platform, shop_code, listing_id, listing_sku_id, product_family_id, product_spu_id, variant_id, bundle_id)`

Use this table because mappings are not always clean:

- Product master `Mercari Shop4 Product ID` can directly match Mercari `商品ID`.
- Product master `Rakuten manageNumber` can match Rakuten `商品管理番号（商品URL）`.
- Product master `RakutenSKU` can match Rakuten `SKU管理番号`.
- Product master `item code` can match Mercari `SKUx_商品管理コード` and sometimes Amazon/Rakuten SKU-like fields.
- A marketplace listing can map to a bundle instead of a single variant.

Constraint recommendation:

- Require at least one of `product_family_id`, `product_spu_id`, `variant_id`, or `bundle_id`.
- For concrete execution, prefer `variant_id` or `bundle_id`.
- Use `product_family_id` or `product_spu_id` alone only for coverage, merchandising, or audit records.

## Current Schema Gap

The current core schema has:

- `products`
- `product_variants`
- `platform_listings`

This is enough for early mock flow, but insufficient for the real files because:

- `products` is ambiguously named and collapses broader family and SPU-level concepts.
- There is no explicit `product_spus` table for `SPU1`.
- Hero Product / merchandising focus is not modeled.
- Mercari has repeating SKU and image slots.
- Rakuten has repeating image slots and 42 attribute pairs.
- Amazon has business quantity pricing tiers.
- Product master mixes canonical product data, cost, inventory, channel pricing targets, and listing IDs.
- Bundles/combo products are not modeled.
- Platform accounts are free text instead of first-class records.
- Product assets are not separated from channel listing images.

The existing untracked migration `20260705000000_align_listings_with_mercari_csv.sql` is directionally right but too narrow. It adds some listing-level Mercari columns and variant fields, but it does not model repeating slots. The design should add child tables instead of only widening `platform_listings` and `product_variants`.

## Recommended Migration Order

### Phase 1: Lossless Ingestion Foundation

Add:

- `source_import_runs`
- `source_import_rows`
- `platform_accounts`
- `product_families`
- `product_spus`
- `product_assets`
- `merchandising_focus_items`
- `bundle_products`
- `bundle_components`
- expanded `platform_listings` columns
- `platform_listing_skus`
- `platform_listing_images`
- `platform_listing_attributes`
- `platform_listing_price_tiers`
- `product_platform_links`

Goal:

- Import all four files without losing source fields.
- Re-run imports idempotently.
- Preserve row-level errors.

### Phase 2: Product Master Normalization

Refactor product master data into:

- `product_families`
- `product_spus`
- `product_variants`
- `product_commercials`

Goal:

- Make `item code` the canonical variant key.
- Make `SPU1` the canonical Product SPU key.
- Keep Product Family as the broader business grouping that can contain multiple SPU1 records.
- Keep channel target prices out of listing snapshots.
- Keep `Shop SKU` as an operational identifier, not a global variant key.
- Manage Hero Product and other merchandising focus at the `product_spus` level through `merchandising_focus_items`.

### Phase 3: Marketplace Link Resolution

Create link resolver jobs:

- Mercari:
  - `product_master.Mercari Shop4 Product ID` -> `platform_listings.external_listing_id`
  - `product_master.item code` -> `platform_listing_skus.sku_code`
- Rakuten:
  - `product_master.Rakuten manageNumber` -> `platform_listings.external_listing_id`
  - `product_master.RakutenSKU` -> `platform_listing_skus.seller_sku`
- Amazon:
  - `product_master.item code` / `Shop SKU` -> `platform_listing_skus.seller_sku`, where possible.

Goal:

- Operators can see one product/variant and all channel listing states.
- Operators can also see bundle listings and distinguish them from one-variant listings.

### Phase 4: Audit and Operator Views

Build views for the operator frontend:

- `listing_audit_input_v`
- `channel_listing_summary_v`
- `product_channel_coverage_v`
- `listing_price_inventory_diff_v`

Goal:

- Listing audit can run against real Supabase data, not pasted CSV only.
- Task creation can link to listing IDs and variant IDs.

## Example SQL Skeleton

```sql
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

create unique index if not exists ux_product_families_family_code
  on product_families(family_code)
  where family_code is not null;

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

alter table product_variants add column if not exists item_code text;
alter table product_variants add column if not exists sku text;
alter table product_variants add column if not exists shop_sku text;
alter table product_variants add column if not exists product_spu_id uuid references product_spus(id) on delete set null;
alter table product_variants add column if not exists material text;
alter table product_variants add column if not exists color_code text;
alter table product_variants add column if not exists raw_payload jsonb;

create table if not exists product_assets (
  id uuid primary key default gen_random_uuid(),
  product_family_id uuid references product_families(id) on delete cascade,
  product_spu_id uuid references product_spus(id) on delete cascade,
  variant_id uuid references product_variants(id) on delete cascade,
  asset_type text not null,
  asset_url text,
  asset_path text,
  position integer,
  source_system text,
  alt_text text,
  metadata jsonb default '{}'::jsonb,
  raw_payload jsonb,
  created_at timestamptz default now()
);

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

create table if not exists bundle_products (
  id uuid primary key default gen_random_uuid(),
  bundle_code text not null unique,
  name text not null,
  bundle_type text not null,
  product_family_id uuid references product_families(id) on delete set null,
  product_spu_id uuid references product_spus(id) on delete set null,
  status text default 'active',
  metadata jsonb default '{}'::jsonb,
  raw_payload jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists bundle_components (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid references bundle_products(id) on delete cascade,
  variant_id uuid references product_variants(id) on delete restrict,
  quantity integer not null default 1,
  component_role text,
  created_at timestamptz default now(),
  unique(bundle_id, variant_id, component_role)
);

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
alter table platform_listings add column if not exists listing_status text default 'unknown';
alter table platform_listings add column if not exists currency text default 'JPY';
alter table platform_listings add column if not exists published_at timestamptz;
alter table platform_listings add column if not exists platform_updated_at timestamptz;
alter table platform_listings add column if not exists source_hash text;

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
```

## Import Mapping Summary

| Source | Source field | Target |
|---|---|---|
| Product master | family grouping / operator curation | `product_families.family_code`, `product_families.family_name` |
| Product master | `SPU1` | `product_spus.spu_code` |
| Product master | `SPU2（メーカー型番）` | `product_spus.manufacturer_model` |
| Product master | `Product Name` | `product_spus.title` |
| Product master | `item code` | `product_variants.item_code` |
| Product master | `Shop SKU` | `product_variants.shop_sku` |
| Product master | `Qty Available` | `product_commercials.source_available_qty` |
| Product master | `Amazon pricing` | `product_commercials.amazon_target_price` |
| Product master | `Rakuten pricing` | `product_commercials.rakuten_target_price` |
| Product master | `Image URLs JSON` | `product_assets` |
| Mercari | `商品ID` | `platform_listings.external_listing_id` |
| Mercari | `商品名` | `platform_listings.title` |
| Mercari | `商品説明` | `platform_listings.description` |
| Mercari | `販売価格` | `platform_listings.current_price` |
| Mercari | `SKUx_商品管理コード` | `platform_listing_skus.sku_code` |
| Mercari | `SKUx_現在の在庫数` | `platform_listing_skus.stock_qty` |
| Mercari | `商品画像登録有無_x` | `platform_listing_images.registered_flag` |
| Rakuten | `商品管理番号（商品URL）` | `platform_listings.external_listing_id` |
| Rakuten | `SKU管理番号` | `platform_listing_skus.seller_sku` |
| Rakuten | `通常購入販売価格` | `platform_listing_skus.current_price` |
| Rakuten | `在庫数` | `platform_listing_skus.stock_qty` |
| Rakuten | `商品画像パスx` | `platform_listing_images.image_path` |
| Rakuten | `商品属性（項目）x` / `商品属性（値）x` | `platform_listing_attributes` |
| Amazon | `seller-sku` | `platform_listing_skus.seller_sku` |
| Amazon | `product-id` | `platform_listing_skus.asin` |
| Amazon | `price` | `platform_listing_skus.current_price` |
| Amazon | `quantity` | `platform_listing_skus.stock_qty` |
| Amazon | `Quantity Lower Bound x` / `Quantity Price x` | `platform_listing_price_tiers` |

## Finalized MVP Decisions

These decisions close the schema questions for the first Supabase implementation.

1. Product images use a canonical product-level asset table.

   Use `product_assets` for the canonical RPagentOS product image library: base images, main images, feature images, size images, color variation images, resource-pack images, and agent-generated images.

   Use `platform_listing_images` only for images currently used by marketplace listings.

   Product master `Image URLs JSON` populates `product_assets`. Mercari image slots and Rakuten image paths populate `platform_listing_images`.

2. Platform statuses store both raw and normalized values.

   Preserve raw platform values in fields such as `listing_status_code`, `sku_status_code`, and `stock_status_code`.

   Store normalized RPagentOS values in fields such as `listing_status`, `sku_status`, and `stock_status`.

   Unknown platform values must not break imports. Preserve the raw value and normalize to `unknown`.

3. The canonical product structure is `product_families` -> `product_spus` -> `product_variants`.

   New canonical logic should use `product_families` for the broader business series, `product_spus` for `SPU1`, and `product_variants` for concrete sellable units.

   Existing `products` can remain temporarily only as a compatibility layer during migration. Do not treat `SPU1` as identical to Product Family.

4. Hero Product is a merchandising focus item at the SPU level.

   Use `merchandising_focus_items` with `focus_type = 'hero'` and `product_spu_id`.

   Do not use `product_spus.is_hero` as the primary design because hero status needs priority, reason, active period, status, and future focus types.

5. `product_variants.sku` should not be renamed now.

   Add and use `product_variants.item_code` as the canonical internal variant key.

   Keep `product_variants.sku` as a backward-compatible alias until existing scripts, importers, and UI paths are migrated safely.

6. Platform-specific extension tables are out of scope for MVP.

   Do not create `mercari_listing_extensions`, `rakuten_listing_extensions`, or `amazon_listing_extensions` in the first implementation.

   Use shared normalized child tables plus `raw_payload`. Add platform-specific extension tables later only after repeated real query needs appear.

## First Implementation Target

Replace the current untracked Mercari-only alignment migration with a broader migration that:

1. Adds import run/row tables.
2. Adds `platform_accounts`.
3. Adds `product_families`.
4. Adds `product_spus`.
5. Expands `product_variants` with `product_spu_id`, `item_code`, `shop_sku`, and migration-compatible fields while keeping `sku`.
6. Adds `product_assets`.
7. Adds `merchandising_focus_items`.
8. Adds `product_commercials`.
9. Adds `bundle_products` and `bundle_components`.
10. Expands `platform_listings` with shared marketplace fields, optional family/SPU cache fields, and raw/normalized status columns.
11. Adds `platform_listing_skus`.
12. Adds `platform_listing_images`.
13. Adds `platform_listing_attributes`.
14. Adds `platform_listing_price_tiers`.
15. Adds `product_platform_links`.

Then implement import jobs in this order:

1. Product master importer.
2. Mercari importer.
3. Rakuten importer.
4. Amazon importer.
5. Link resolver job.

## Migration Note: Existing Products to Family/SPU/Variant

Do not force a destructive rename in the first migration.

Recommended migration path:

1. Create `product_families` and `product_spus`.
2. Backfill `product_spus` from distinct product master `SPU1` values.
3. Populate `product_spus.manufacturer_model` from `SPU2（メーカー型番）` and `product_spus.title` from the best shared product title for the SPU.
4. Create or curate `product_families` as broader business groupings. A family may contain multiple SPU1 records, such as all outdoor storage boxes.
5. Attach each `product_spus.product_family_id` once the family grouping is known. If family grouping is not yet curated, keep it null or assign a conservative importer-created family.
6. Add `product_variants.product_spu_id` and backfill it by matching product master `SPU1` to `product_spus.spu_code`.
7. Populate `product_variants.item_code` from product master `item code`.
8. Keep `product_variants.sku` as a backward-compatible alias until importers, operator views, and scripts use `item_code`.
9. Keep existing `products` only as a temporary compatibility layer or view while callers migrate.
10. Move authoritative marketplace mapping into `product_platform_links`; do not hardcode internal product relationships directly on `platform_listings`.

## Final Framing

This schema should not be treated as a simple listing database. It should be the Product and Listing Intelligence Control Tower for RPagentOS.

The stable core should answer:

- What is the product family?
- What are the sellable variants?
- Which marketplaces are they listed on?
- Which listing SKU maps to which internal variant or bundle?
- Which images, titles, descriptions, prices, and stock values are currently used?
- What changed since the last import?
- What needs audit, optimization, bundle creation, or human approval?

This framing matters because RPagentOS is intended to support agent-driven audit, optimization, bundle creation, channel coverage analysis, and controlled marketplace execution, not only CRUD storage.

## Version Change Log

### 2026-07-06

- Added explicit terminology for Product Family, Product SPU/SPU1, SKU/Product Variant, Marketplace Listing, and relationship modeling.
- Replaced the proposed family/SPU collapse with separate `product_families` and `product_spus` tables.
- Clarified that `SPU1` is the Product SPU key and `SPU2（メーカー型番）` is a manufacturer model or secondary grouping reference.
- Clarified that product master `item code` is the canonical internal variant key and `Shop SKU` is operational but not globally unique.
- Made `product_platform_links` the authoritative mapping table.
- Downgraded `platform_listings.product_family_id` to optional denormalized convenience only.
- Added `bundle_products` and `bundle_components`.
- Added `product_assets`.
- Added `platform_accounts`.
- Added normalized-status/check-constraint guidance.
- Closed MVP open decisions and marked the schema finalized for MVP Supabase implementation.
- Confirmed `product_assets` as the canonical product image library and `platform_listing_images` as channel-current listing images.
- Confirmed raw-plus-normalized platform status storage with unknown-value fallback.
- Confirmed `product_variants.item_code` as canonical while keeping `product_variants.sku` as a backward-compatible migration alias.
- Confirmed no platform-specific extension tables for MVP; use shared child tables plus `raw_payload` first.
- Corrected hierarchy from Product Family/SPU collapse to `product_families` -> `product_spus` -> `product_variants`.
- Moved `SPU1` mapping to `product_spus.spu_code` and `SPU2（メーカー型番）` mapping to `product_spus.manufacturer_model`.
- Added `merchandising_focus_items` for Hero Product and future merchandising focus at the SPU level.
- Updated `product_assets`, `platform_listings`, and `product_platform_links` to support family/SPU/variant scoped relationships.
- Added migration note for moving from existing `products` / `product_variants` to `product_families` / `product_spus` / `product_variants`.
