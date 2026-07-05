# Product and Listing Import Plan

Date: 2026-07-06
Status: Draft import execution plan for Supabase MVP
Source folder: `data/product and listings`

## Definition of Done

The product/listing import is done only when all source files in `data/product and listings` are imported into Supabase with raw preservation, normalized records, link resolution, validation reports, and operator-ready query surfaces.

### 1. Source Files Loaded

Before source files are loaded:

- existing dummy/demo product and listing rows are removed or archived
- `supabase/seed.sql` does not recreate dummy product/listing rows
- target import tables are verified clean enough for first real import

All source files are processed:

- `export - Products - Grid.csv`
- `mercari shop4 listing.csv`
- `export - Rakuten listings - Grid (1).csv`
- `amazon_open_listings_lite.tsv`
- `export - Amazon listings mapping.csv`

Each file has one successful `source_import_runs` row with:

- source file path
- file hash
- row count
- source system
- platform/shop where applicable
- `status = 'completed'`

Each source row has one `source_import_rows` record with the raw row preserved.

### 2. Product Master Imported

Done when:

- all nonblank unique `item code` values exist in `product_variants.item_code`
- all nonblank `SPU1` values exist in `product_spus.spu_code`
- `SPU2（メーカー型番）` is mapped to `product_spus.manufacturer_model`
- `Shop SKU` is stored as `product_variants.shop_sku`, but not used as a unique key
- `product_variants.sku` is populated only as a compatibility alias
- commercial fields are loaded into `product_commercials`
- product images from `Image URLs JSON` / main image fields are loaded into `product_assets`

### 3. Marketplace Listings Imported

Done when:

- Mercari `商品ID` rows are in `platform_listings`
- Mercari populated SKU/image slots are in child tables
- Rakuten item pages are in `platform_listings`
- Rakuten SKU rows, image slots, and attribute slots are in child tables
- Amazon open listings are in `platform_listings` and `platform_listing_skus`
- Amazon business/quantity price tiers are in `platform_listing_price_tiers`
- raw and normalized status values are both stored

### 4. Amazon Mapping Imported

Done when:

- all rows from `export - Amazon listings mapping.csv` are preserved
- mapping `Item Code` resolves to `product_variants.item_code` where available
- mapping `SKU` resolves to Amazon `platform_listing_skus.seller_sku`
- all current Amazon open-listing SKUs are resolved through the mapping file
- missing mappings are reported, not silently ignored

### 5. Platform Links Resolved

Done when `product_platform_links` contains authoritative links for:

- Mercari via product master `Mercari Shop4 Product ID` and/or `item code`
- Rakuten via `Rakuten manageNumber` and `RakutenSKU`
- Amazon via Amazon mapping CSV

Each link should include:

- platform
- shop code
- listing ID
- listing SKU ID where applicable
- variant ID where resolved
- SPU/family IDs where available
- match method
- confidence where applicable

### 6. Validation Reports Generated

Done when these reports exist and are reviewed:

- import row errors
- duplicate key exceptions
- unresolved platform links
- multi-match platform links
- unknown status values
- image import summary
- Amazon mapping exceptions

Critical failures must be fixed or explicitly documented.

### 7. Idempotency Verified

Done when re-running the same imports:

- does not duplicate listings
- does not duplicate SKUs
- does not duplicate images/attributes/price tiers
- does not duplicate product variants
- updates changed rows based on stable keys / hashes

### 8. Operator Readiness

Done when imported data can answer:

- what Product Family / SPU / Variant does this listing SKU map to?
- which listings exist per product variant?
- which marketplace SKUs are unresolved?
- which listings have price, stock, image, or status differences?
- which products are ready for listing audit?

### 9. Non-Blocking Gaps Documented

Done when any remaining gaps are listed clearly, especially:

- missing Product Family curation
- unknown status-code mappings
- unresolved marketplace links
- Amazon mapping rows with missing product master item codes
- duplicate or conflicting marketplace SKU mappings

Final import status should be considered complete only when the import is repeatable, auditable, and usable by the listing audit/operator workflow.

This document is a plan only. It does not implement import code or run database migrations.

## Source Files

| Source system | File | Rows | Columns | File hash prefix | Delimiter |
|---|---:|---:|---:|---|---|
| `product_master` | `export - Products - Grid.csv` | 5,572 | 136 | `148ca6822cbce682` | CSV |
| `mercari` | `mercari shop4 listing.csv` | 5,208 | 178 | `e0bfa2f46774caea` | CSV |
| `rakuten` | `export - Rakuten listings - Grid (1).csv` | 1,582 | 578 | `9f828c9561224717` | CSV |
| `amazon` | `amazon_open_listings_lite.tsv` | 87 | 24 | `51364ff0692b86b3` | TSV |
| `amazon_mapping` | `export - Amazon listings mapping.csv` | 141 | 3 | `03ce097eeac6c1c9` | CSV |

## Import Order

1. Run schema migration.
2. Run pre-import dummy/demo cleanup.
3. Seed `platform_accounts`.
4. Import product master.
5. Import Mercari Shop4 listings.
6. Import Rakuten listings.
7. Import Amazon listing mapping.
8. Import Amazon open listings.
9. Run link resolver.
10. Run validation views and exception reports.

Reason:

- Product master defines canonical families, SPUs, variants, product assets, and commercial target data.
- Dummy/demo rows must be removed before real imports so validation counts, link resolution, and operator views are not polluted.
- Marketplace imports should land as channel-current snapshots.
- Amazon mapping should load before link resolution so Amazon seller SKUs can map back to internal item codes.
- Link resolution should run after all internal and platform records exist.

## Source Import Control

Every file import creates one `source_import_runs` row:

- `source_system`
- `platform`
- `shop_code`
- `source_file`
- `file_hash`
- `row_count`
- `status`
- `metadata`

Every source row creates one `source_import_rows` row:

- `run_id`
- `row_index`
- `source_key`
- `row_hash`
- `raw_row`
- `normalized_status`
- `error_message`

Rules:

- Store raw rows losslessly before normalization.
- Use `utf-8-sig` for CSV/TSV parsing to handle BOM.
- Recompute row hash from the raw row object after stable key ordering.
- Importers must be idempotent: same file and row should not create duplicate normalized records.
- Unknown status values must not fail import. Preserve raw values and normalize to `unknown`.

## Phase 1: Platform Accounts

Seed these MVP accounts before marketplace import:

| platform | shop_code | display_name |
|---|---|---|
| `mercari` | `shop4` | `Mercari Shop4` |
| `rakuten` | `homebliss` | `Rakuten Homebliss` |
| `amazon` | `jp` | `Amazon Japan` |

Use `platform_accounts.id` on `platform_listings.platform_account_id`.

## Phase 2: Product Master Import

Source:

`export - Products - Grid.csv`

Observed identity quality:

- `item code`: 5,570 nonblank, 5,570 unique
- `Shop SKU`: 5,572 nonblank, 3,847 unique, not a canonical key
- `SPU1`: 5,570 nonblank, 2,310 unique
- `SPU2（メーカー型番）`: 5,570 nonblank, 1,604 unique
- `Mercari Shop4 Product ID`: 5,187 nonblank, 5,179 unique
- `Rakuten manageNumber`: 1,010 nonblank, 514 unique
- `RakutenSKU`: 1,010 nonblank, 1,010 unique

### 2.1 Product Families

Target:

`product_families`

Because the current export does not provide a clean broader-family field, use conservative MVP family creation:

- If a curated family mapping table exists, use it.
- Otherwise create importer-generated family records from a conservative grouping such as `Product group`, `Giga Product Group`, or category fields.
- If no reliable family grouping exists, leave `product_spus.product_family_id` null or attach to an importer-generated family that is clearly marked in `raw_payload` / `strategy_notes`.

Do not treat `SPU1` as the Product Family key.

### 2.2 Product SPUs

Target:

`product_spus`

Upsert key:

- `spu_code`

Mappings:

| Source field | Target |
|---|---|
| `SPU1` | `product_spus.spu_code` |
| `Product Name` | `product_spus.title` |
| `SPU2（メーカー型番）` | `product_spus.manufacturer_model` |
| category fields | `product_spus.category` |
| raw row | `product_spus.raw_payload` |

Title rule:

- Choose the most common nonblank `Product Name` within the same `SPU1`.
- If tied, choose the first stable row by source row index.

### 2.3 Product Variants

Target:

`product_variants`

Upsert key:

- `item_code`

Mappings:

| Source field | Target |
|---|---|
| `item code` | `product_variants.item_code` |
| `item code` | `product_variants.sku` as temporary compatibility alias |
| `Shop SKU` | `product_variants.shop_sku` |
| `SPU1` | lookup `product_spus.id`, then `product_variants.product_spu_id` |
| color/material/size/package fields | corresponding variant columns |
| raw row | `product_variants.raw_payload` |

Rules:

- Skip normalized variant upsert if `item code` is blank, but keep the row in `source_import_rows` with an error.
- Do not use `Shop SKU` for uniqueness.
- Keep `sku` populated only for backward compatibility.

### 2.4 Product Commercials

Target:

`product_commercials`

Upsert key:

- `variant_id`

Mappings:

| Source field | Target |
|---|---|
| `Qty Available` | `source_available_qty` |
| `Qty Purchased` | `purchased_qty` |
| `Owned Qty` | `owned_qty` |
| `Unit Price` | `source_unit_price` |
| `Discounted Unit Price` | `discounted_unit_price` |
| `Unit Fulfillment Fee (Drop Shipping)` | `fulfillment_fee` |
| `Amazon pricing` | `amazon_target_price` |
| `Rakuten pricing` | `rakuten_target_price` |
| Mercari effective price fields | Mercari target/effective pricing fields |
| readiness/audit fields | `listing_readiness_score`, `audit_notes` |

### 2.5 Product Assets

Target:

`product_assets`

Source fields:

- `Image URLs JSON`
- `Product Main Image`
- resource package fields, where usable

Scope rule:

- If an image is shared across all variants of an SPU, set `product_spu_id`.
- If it is variant/color specific, set `variant_id`.
- If it is only series-level branding or category image, set `product_family_id`.

Upsert key recommendation:

- `coalesce(product_family_id, product_spu_id, variant_id) + asset_url + position + source_system`

## Phase 3: Mercari Shop4 Import

Source:

`mercari shop4 listing.csv`

Observed identity quality:

- `商品ID`: 5,208 nonblank, 5,208 unique
- `SKU1_商品管理コード`: 5,208 nonblank, 5,208 unique
- SKU slots per listing: 5,188 listings with 1 SKU, 20 listings with 2-5 SKUs
- `商品ステータス`: values observed as `2` and `1`

### 3.1 Platform Listings

Target:

`platform_listings`

Upsert key:

- `platform = 'mercari'`
- `shop_code = 'shop4'`
- `external_listing_id = 商品ID`

Mappings:

| Source field | Target |
|---|---|
| `商品ID` | `external_listing_id` |
| `スナップショットID` | `external_snapshot_id` |
| `商品名` | `title` |
| `商品説明` | `description` |
| `販売価格` | `current_price` |
| `カテゴリID` | `category_id` |
| `商品ステータス` | `listing_status_code` |
| normalized status map | `listing_status` |
| `商品登録日時` | `published_at` |
| `最終更新日時` | `platform_updated_at` |
| full row | `raw_payload` |

Initial status map:

- `2` -> `active`
- `1` -> `inactive`
- anything else -> `unknown`

Confirm this map against Mercari UI/API behavior before using it for execution decisions.

### 3.2 Platform Listing SKUs

Target:

`platform_listing_skus`

Loop:

- `SKU1_*` through `SKU10_*`

Create one row per populated SKU slot.

Upsert key:

- `listing_id`
- `sku_position`

Mappings:

| Source field | Target |
|---|---|
| `SKUx_ID` | `external_sku_id` |
| `SKUx_商品管理コード` | `sku_code` |
| `SKUx_種類名1` / option fields | `option_name_1`, `option_value_1` |
| `SKUx_種類名2` / option fields | `option_name_2`, `option_value_2` |
| `SKUx_JANコード` | `jan_code` |
| `SKUx_販売価格` or listing price fallback | `current_price` |
| `SKUx_現在の在庫数` | `stock_qty` |
| raw SKU slot object | `raw_payload` |

### 3.3 Platform Listing Images

Target:

`platform_listing_images`

Loop:

- image slots 1 through 20

Upsert key:

- `listing_id`
- `image_position`

Mappings:

| Source field | Target |
|---|---|
| `商品画像名_x` | `image_name` |
| `商品画像更新フラグ_x` | `update_flag` |
| `商品画像登録有無_x` | `registered_flag` |
| raw slot object | `raw_payload` |

## Phase 4: Rakuten Import

Source:

`export - Rakuten listings - Grid (1).csv`

Observed identity quality:

- `商品管理番号（商品URL）`: 1,582 nonblank, 534 unique
- `SKU管理番号`: 1,048 nonblank, 1,028 unique
- `システム連携用SKU番号`: 1,034 nonblank, 1,014 unique
- Rakuten rows are variant/SKU rows grouped under repeated item pages.

### 4.1 Platform Listings

Target:

`platform_listings`

Upsert key:

- `platform = 'rakuten'`
- `shop_code = 'homebliss'`
- `external_listing_id = 商品管理番号（商品URL）`

Mappings:

| Source field | Target |
|---|---|
| `商品管理番号（商品URL）` | `external_listing_id`, `manage_number` |
| `商品名` | `title` |
| `PC用商品説明文` / `スマートフォン用商品説明文` | `description` |
| `ジャンルID` | `category_id` |
| `倉庫指定`, `サーチ表示`, order button fields | `listing_status_code` / raw payload |
| normalized status map | `listing_status` |
| full row | `raw_payload` |

Initial status normalization:

- If `倉庫指定 = 0` and `サーチ表示 = 1`, treat as `active`.
- If search hidden, warehouse, or order button unavailable, treat as `inactive` or `draft` after UI confirmation.
- Unknown combinations -> `unknown`.

### 4.2 Platform Listing SKUs

Target:

`platform_listing_skus`

Create one row per source row where SKU fields are populated.

Upsert key:

- Prefer `listing_id + seller_sku`.
- If `seller_sku` is blank, use `listing_id + sku_position`.

Mappings:

| Source field | Target |
|---|---|
| `SKU管理番号` | `seller_sku` |
| `システム連携用SKU番号` | `sku_code` |
| `通常購入販売価格` | `current_price` |
| `在庫数` | `stock_qty` |
| SKU option columns | option fields |
| full row SKU fields | `raw_payload` |

### 4.3 Platform Listing Images

Target:

`platform_listing_images`

Loop:

- image slots 1 through 20

Upsert key:

- `listing_id`
- `image_position`

Mappings:

| Source field | Target |
|---|---|
| `商品画像タイプx` | `image_type` |
| `商品画像パスx` | `image_path` |
| `商品画像名（ALT）x` | `alt_text` |

### 4.4 Platform Listing Attributes

Target:

`platform_listing_attributes`

Loop:

- `商品属性（項目）x`
- `商品属性（値）x`
- `商品属性（単位）x`

Create one row per populated attribute pair.

## Phase 5: Amazon Listing Mapping Import

Source:

`export - Amazon listings mapping.csv`

Observed identity quality:

- rows: 141
- columns: `id`, `Item Code`, `SKU`
- `Item Code`: 141 nonblank, 129 unique, 12 duplicates
- `SKU`: 141 nonblank, 141 unique
- mapping `Item Code` values found in product master: 127 of 129
- mapping `SKU` values found in current Amazon open listings: 87 of 141
- current Amazon open-listings SKUs covered by mapping: 87 of 87

Purpose:

- Map Amazon seller SKUs back to canonical internal variants.
- Preserve the source mapping rows in `source_import_rows`.
- Feed `product_platform_links` during link resolution.

MVP storage:

- If an explicit mapping table is not added yet, store mapping rows in `source_import_rows` and let the resolver read the latest successful `amazon_mapping` run.
- If a small helper table is added, use `amazon_listing_sku_mappings` or a generic `external_sku_mappings` table later. This is optional for MVP because `source_import_rows.raw_row` is enough for deterministic resolution.

Mapping fields:

| Source field | Meaning |
|---|---|
| `Item Code` | internal variant key, maps to `product_variants.item_code` |
| `SKU` | Amazon seller SKU, maps to `platform_listing_skus.seller_sku` |

Rules:

- Treat `SKU` as unique within the mapping file.
- Allow one `Item Code` to map to multiple Amazon `SKU` values. This is valid because one internal variant can have multiple Amazon offers/listing SKUs.
- Mapping rows whose `Item Code` is missing from product master should go to the unresolved mapping report.
- Mapping rows whose `SKU` is not in the current Amazon open-listings file should remain available for future Amazon imports, but should not create platform listing rows by themselves.

## Phase 6: Amazon Import

Source:

`amazon_open_listings_lite.tsv`

Observed identity quality:

- `seller-sku`: 87 nonblank, 87 unique
- `product-id`: 87 nonblank, 80 unique
- This export has no title, description, category, or image fields.
- Current file is fully covered by `export - Amazon listings mapping.csv`: 87 of 87 `seller-sku` values have a mapping row.

### 5.1 Platform Listings

Target:

`platform_listings`

Upsert key:

- `platform = 'amazon'`
- `shop_code = 'jp'`
- `external_listing_id = seller-sku`

Mappings:

| Source field | Target |
|---|---|
| `seller-sku` | `external_listing_id` |
| `price` | `current_price` |
| `quantity` | `stock_qty` |
| quantity-derived status | `listing_status` |
| full row | `raw_payload` |

Status normalization:

- `quantity > 0` -> `active`
- `quantity = 0` -> `sold_out`
- missing or invalid quantity -> `unknown`

### 5.2 Platform Listing SKUs

Target:

`platform_listing_skus`

Upsert key:

- `listing_id`
- `seller_sku`

Mappings:

| Source field | Target |
|---|---|
| `seller-sku` | `seller_sku`, `sku_code` |
| `product-id` | `asin` |
| `price` | `current_price` |
| `Business Price` | `business_price` |
| `quantity` | `stock_qty` |

### 5.3 Platform Listing Price Tiers

Target:

`platform_listing_price_tiers`

Loop:

- `Quantity Lower Bound 1..5` / `Quantity Price 1..5`
- `Progressive Lower Bound 1..3` / `Progressive Price 1..3`

Create one row per populated tier.

## Phase 7: Link Resolver

Target:

`product_platform_links`

Run link resolution after all imports.

### Mercari Link Rules

Observed:

- product master `Mercari Shop4 Product ID` matches Mercari `商品ID`: 5,175 matches
- product master `item code` matches Mercari SKU codes: 5,175 matches

Resolution order:

1. Match `product_master.Mercari Shop4 Product ID` to `platform_listings.external_listing_id`.
2. Match `product_master.item code` to `platform_listing_skus.sku_code`.
3. Create `product_platform_links` with `variant_id`, `product_spu_id`, `product_family_id` if known, `listing_id`, and `listing_sku_id`.
4. If listing matches but SKU does not, create lower-confidence listing-level link for audit only.

### Rakuten Link Rules

Observed:

- product master `Rakuten manageNumber` matches Rakuten `商品管理番号（商品URL）`: 514 matches
- product master `RakutenSKU` matches Rakuten `SKU管理番号`: 1,010 matches
- product master `item code` barely matches Rakuten `システム連携用SKU番号`: 2 matches

Resolution order:

1. Match `product_master.Rakuten manageNumber` to `platform_listings.external_listing_id`.
2. Match `product_master.RakutenSKU` to `platform_listing_skus.seller_sku`.
3. Avoid relying on `item code` for Rakuten SKU matching unless later exports prove it is reliable.
4. Create `product_platform_links` with `match_method = 'product_master_platform_id'` or `match_method = 'rakuten_sku'`.

### Amazon Link Rules

Observed:

- product master `item code` vs Amazon `seller-sku`: 0 direct matches
- product master `Shop SKU` vs Amazon `seller-sku`: 0 direct matches
- Amazon mapping `SKU` vs Amazon `seller-sku`: 87 matches, covering all current Amazon open-listings rows
- Amazon mapping `Item Code` vs product master `item code`: 127 matched item codes out of 129 unique mapping item codes

Resolution order:

1. Read the latest successful `amazon_mapping` import.
2. Match mapping `Item Code` to `product_variants.item_code`.
3. Match mapping `SKU` to `platform_listing_skus.seller_sku`.
4. Create `product_platform_links` with `match_method = 'amazon_mapping_csv'`.
5. If one `Item Code` maps to multiple Amazon `SKU` values, create one link per Amazon listing SKU. This is expected and should not be treated as a duplicate error.
6. If mapping `Item Code` is not found in `product_variants`, report it in `unresolved_platform_links` or `unresolved_mapping_rows`.
7. If Amazon `seller-sku` is not in the mapping file, import it losslessly and report it as unresolved.

## Validation Reports

Generate these reports after each import run:

1. `import_row_errors`
   - rows that failed normalization
   - source file, row index, source key, error

2. `duplicate_key_exceptions`
   - duplicate platform keys after normalization
   - duplicate `item_code`
   - duplicate unexpected marketplace SKU keys

3. `unresolved_platform_links`
   - marketplace listings/SKUs with no `product_platform_links`
   - Amazon mapping rows whose `Item Code` does not resolve to `product_variants.item_code`
   - Amazon open-listing rows whose `seller-sku` does not resolve through the mapping file

4. `multi_match_platform_links`
   - one marketplace SKU matching multiple variants
   - one variant matching multiple active marketplace SKU records on same platform/shop
   - one variant matching multiple Amazon seller SKUs is allowed when it comes from explicit Amazon mapping rows

5. `status_unknown_report`
   - raw status values normalized to `unknown`

6. `image_import_summary`
   - product asset count by family/SPU/variant
   - listing image count by platform/listing

## Post-Import Acceptance Criteria

Product master:

- All source rows are present in `source_import_rows`.
- All nonblank unique `item code` values are present in `product_variants.item_code`.
- All nonblank `SPU1` values are present in `product_spus.spu_code`.
- `Shop SKU` is imported but not used as a unique key.

Mercari:

- All 5,208 `商品ID` values upsert to `platform_listings`.
- All populated SKU slots upsert to `platform_listing_skus`.
- All image slots are represented where populated.
- Mercari link resolver creates expected links for product ID and item-code matches.

Rakuten:

- 534 unique item pages upsert to `platform_listings`.
- Populated SKU rows upsert to `platform_listing_skus`.
- Image and attribute slot tables are populated from repeated columns.
- Link resolver uses `Rakuten manageNumber` and `RakutenSKU`, not `item code`, as primary Rakuten match keys.

Amazon:

- All 141 Amazon mapping rows import into `source_import_rows`.
- All 87 rows import into `platform_listings` and `platform_listing_skus`.
- Business/quantity tiers import where populated.
- All 87 current Amazon seller SKUs resolve through `export - Amazon listings mapping.csv`.
- Mapping rows whose SKUs are not present in the current Amazon open-listings file remain available for future imports and do not create listing rows by themselves.

## Implementation Shape

Recommended importer modules:

```text
src/packages/listing-import/
  src/
    import-run.ts
    parse-source-file.ts
    import-product-master.ts
    import-mercari.ts
    import-rakuten.ts
    import-amazon-mapping.ts
    import-amazon.ts
    resolve-platform-links.ts
    status-normalizers.ts
    validation-reports.ts
```

Recommended CLI jobs:

```text
npm run import:product-master -- --file "data/product and listings/export - Products - Grid.csv"
npm run import:mercari -- --shop shop4 --file "data/product and listings/mercari shop4 listing.csv"
npm run import:rakuten -- --shop homebliss --file "data/product and listings/export - Rakuten listings - Grid (1).csv"
npm run import:amazon-mapping -- --file "data/product and listings/export - Amazon listings mapping.csv"
npm run import:amazon -- --shop jp --file "data/product and listings/amazon_open_listings_lite.tsv"
npm run import:resolve-links
npm run import:validate
```

## MVP Non-Goals

- Do not infer Amazon product links from title because this export has no title. Use `export - Amazon listings mapping.csv`.
- Do not use `Shop SKU` as a canonical product key.
- Do not create platform-specific extension tables yet.
- Do not make Hero Product a boolean on `product_spus`.
- Do not overwrite raw payloads with normalized-only data.

## Open Implementation Inputs

These inputs are useful before writing import code:

- confirmed Supabase table migration name
- exact `platform_accounts.shop_code` values to use in production
- curated Product Family mapping rules, if available
- confirmed Mercari and Rakuten status code maps from UI/API behavior
- decision on whether Amazon mapping remains resolver-only via `source_import_rows` or gets a small persistent helper table later
