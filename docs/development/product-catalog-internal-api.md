# Product Catalog Internal API

The RPagentOS Cloudflare Pages deployment owns the server-side read boundary for
the `product_catalog` domain. Marketplace consumers must use this API instead of
holding a Supabase service-role key or querying PostgREST directly.

## Read one SKU

`GET /api/internal/catalog/sku/:item_code`

Authentication:

```http
Authorization: Bearer <INTERNAL_CATALOG_API_TOKEN>
```

Successful response (`200`):

```json
{
  "item_code": "N511P407695W",
  "source_available_qty": 0,
  "sync_status": "synced",
  "last_sync_success_at": "2026-07-15T06:54:00.000Z"
}
```

Quantity `0` is a known zero and is never replaced by `null`. If the SKU exists
but has no `product_commercials` row, the three commercial/sync fields are
`null`; consumers must fail closed on that unknown state. The endpoint returns:

- `400 item_code_required` for an empty path parameter
- `401 unauthorized` for missing or invalid bearer authentication
- `404 sku_not_found` when no canonical variant exists
- `409 duplicate_item_code` when canonical identity is ambiguous
- `502 catalog_upstream_error` when the owner cannot read Supabase
- `503 service_not_configured` when a required server secret is absent

## Runtime configuration

Set these only as Cloudflare server-side secrets/variables:

- `INTERNAL_CATALOG_API_TOKEN`
- `CATALOGSYNC_PIPELINE_API_TOKEN` (scoped credential for the three listing
  pipeline endpoints; existing internal API clients remain valid)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

The service-role key is never returned to callers. Responses use
`Cache-Control: no-store`.

## Read inventory for a marketplace batch

`POST /api/internal/catalog/inventory-query`

The bearer authentication is identical to the single-SKU endpoint. Request:

```json
{"item_codes":["N511P407695W","N511P407695B"]}
```

The request must contain 1–200 unique, non-empty item codes. A successful
lookup returns HTTP `200` even when individual codes cannot safely be used:

```json
{
  "results": [
    {
      "requested_item_code": "n511p407695w",
      "item_code": "N511P407695W",
      "source_available_qty": 0,
      "sync_status": "synced",
      "last_sync_success_at": "2026-07-15T06:54:00.000Z"
    },
    {
      "requested_item_code": "n511p407695b",
      "item_code": "N511P407695B",
      "error": "sync_not_ready"
    }
  ]
}
```

`results` follows request order. Lookup is case-insensitive, while `item_code`
always returns the canonical spelling stored by the owner. The additional
`requested_item_code` preserves the caller-to-canonical mapping. Requests that
repeat an identity with different case are rejected as duplicates.

The versioned cross-repository contract fixture is
`contracts/internal-catalog/inventory-query-v1.fixture.json`. Owner and consumer
tests must use this fixture so the `results` envelope, exact-zero behavior, and
case-normalized identity mapping cannot drift independently.

A usable result contains the four owner-approved fields and only includes a
non-negative integer quantity, `sync_status: "synced"`, and a recorded success
timestamp. Known zero remains `0`. Missing, ambiguous, unknown, or not-ready
states instead contain one of these per-item errors: `sku_not_found`,
`duplicate_item_code`, `commercial_state_missing`,
`duplicate_commercial_state`, `source_quantity_unknown`, or `sync_not_ready`.
Marketplace callers must not publish inventory for an errored result.

The endpoint proves that a sync succeeded at the returned timestamp; it does
not impose a maximum age because marketplace freshness tolerances are consumer
policy. Each consumer must reject `last_sync_success_at` older than its approved
freshness threshold before publishing inventory.

Malformed bodies and duplicate request codes return `400`; more than 200 codes
returns `413`. An owner-database failure returns `502` for the whole request.

## Write marketplace listing states

`POST /api/internal/catalog/listing-state`

The bearer authentication is identical to the other internal catalog endpoints.

Request:

```json
{
  "updates": [{
    "platform": "mercari",
    "shop_code": "shop1",
    "item_code": "GIGA-ITEM-CODE",
    "external_listing_id": "mercari-product-id",
    "external_sku_id": "mercari-variant-id",
    "sku_code": "GIGA-ITEM-CODE",
    "listing_status": "UNOPENED",
    "observed_at": "2026-08-01T00:00:00.000Z",
    "idempotency_key": "stable-caller-generated-key",
    "metadata": {"score": 84}
  }]
}
```

### Constraints

- 1-100 updates per request
- All keys are validated; unknown keys are rejected
- `platform`, `shop_code`, `item_code`, `external_listing_id`, `external_sku_id`,
  `sku_code`, `listing_status`, `observed_at`, `idempotency_key` are required,
  non-blank strings with maximum lengths
- `observed_at` must be a valid ISO-8601 timestamp
- `listing_status` must be one of `UNOPENED`, `OPENED`, `CLOSED`, `SUSPENDED`
  (case-insensitive input, normalized uppercase storage)
- `metadata` is optional, must be an object, and must not exceed 16 KiB when
  serialized
- Duplicate identities (`platform` + `shop_code` + `external_listing_id`) within
  a single request are rejected

### Variant resolution

The endpoint resolves `product_variants.id` by case-insensitive exact match
on `item_code` using batched PostgREST reads. Per-row errors:

- `variant_not_found` — no canonical variant exists for `item_code`
- `duplicate_item_code` — multiple variants share the same normalized identity

These rows are rejected and the listing/tables are never touched.

### Identity conflict detection

Existing `platform_listings` and `platform_listing_skus` (position 1) are read
for the bounded platform/shop/external-ID tuples. If an existing listing maps to
a different `variant_id` or the existing SKU row maps to a different `sku_code`
or `external_sku_id`, the update returns `identity_conflict` and the row is
never overwritten.

### Legal status transitions

| Current state | Allowed next states |
|---|---|
| (missing) | `UNOPENED`, `OPENED`, `CLOSED`, `SUSPENDED` |
| `UNOPENED` | `UNOPENED`, `OPENED`, `CLOSED`, `SUSPENDED` |
| `OPENED` | `OPENED`, `CLOSED`, `SUSPENDED` |
| `CLOSED` | `CLOSED` |
| `SUSPENDED` | `SUSPENDED` |

Illegal transitions return `illegal_status_transition`.

### Upsert behavior

Both `platform_listings` (on `platform, shop_code, external_listing_id`) and
`platform_listing_skus` (on `listing_id, sku_position=1`) use PostgREST with
`Prefer: resolution=merge-duplicates,return=representation`.

The following fields are written to `platform_listings`:
- `platform`, `shop_code`, `external_listing_id`, `variant_id`, `listing_status`
- `platform_updated_at` set to `observed_at`
- `raw_payload` merged preserving all unrelated keys with a new
  `catalogsync_listing_state` object containing `observed_at`, `idempotency_key`,
  caller metadata, plus:
  - `queued_at` — set on first `UNOPENED` and preserved thereafter
  - `opened_at` — set on first `OPENED` and preserved thereafter

The following fields are written to `platform_listing_skus`:
- `listing_id`, `sku_position=1`, `variant_id`, `external_sku_id`, `sku_code`,
  `seller_sku`
- `raw_payload` merged similarly

### Idempotency

A retry with an identical `idempotency_key` to the stored value returns
`unchanged` without additional writes.

### Response

HTTP `200` with results in input order:

```json
{
  "results": [
    {"platform": "mercari", "shop_code": "shop1", "external_listing_id": "mercari-prod-1", "result": "created"},
    {"platform": "mercari", "shop_code": "shop1", "external_listing_id": "mercari-prod-2", "error": "variant_not_found"},
    {"platform": "mercari", "shop_code": "shop1", "external_listing_id": "mercari-prod-3", "result": "unchanged"}
  ]
}
```

Each result is either `created`, `updated`, `unchanged`, or one of the per-row
errors: `variant_not_found`, `duplicate_item_code`, `identity_conflict`,
`illegal_status_transition`.

### Error responses

- `400` — validation failures (malformed body, invalid/oversized fields,
  unknown keys, duplicate identities, invalid count)
- `401 unauthorized` — missing or invalid bearer authentication
- `405 method_not_allowed` — non-POST request
- `502 catalog_upstream_error` — any upstream/PostgREST failure (fail closed,
  no partial success)
- `503 service_not_configured` — required server secrets absent

## Write source import batch

`POST /api/internal/catalog/source-imports/batch`

The bearer authentication is identical to the other internal catalog endpoints.

Request:

```json
{
  "run": {
    "source_system": "gigab2b_saved",
    "window_start": "2025-01-01T00:00:00.000Z",
    "window_end": "2025-02-01T00:00:00.000Z",
    "run_key": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "is_bootstrap": true
  },
  "rows": [{
    "row_index": 1,
    "item_code": "N511P407695W",
    "source_added_at": "2025-01-15T00:00:00.000Z",
    "source_updated_at": null,
    "row_hash": "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    "variant": {
      "variant_name": "Product Title",
      "color": "Red",
      "material": "Cotton",
      "raw_payload": {}
    },
    "commercial": {
      "source_available_qty": 10,
      "owned_qty": 0,
      "source_unit_price": 1000,
      "discounted_unit_price": null,
      "fulfillment_fee": 500,
      "effective_cost_price": 1500,
      "inventory_status": "in_stock",
      "restock_date": null,
      "raw_payload": {}
    }
  }]
}
```

### Constraints

- 1-100 rows, `run` and `rows` are required; unknown top-level keys are rejected.
- `source_system` must be `gigab2b_saved`.
- `window_start` and `window_end` must be valid ISO-8601 timestamps, and
  `window_start` must be before `window_end`.
- `run_key` and each `row_hash` must be 64-character SHA-256 hex digests;
  `is_bootstrap` must be a boolean.
- Each row must contain exactly the specified keys; unknown keys are rejected.
- `row_index` must be a positive integer and unique within the request.
- `item_code` must be a non-empty string (max 128 chars) and unique
  case-insensitively within the request.
- `source_added_at` and `source_updated_at` (if non-null) must be valid ISO
  timestamps, must not exceed `window_end`, and must not be in the future.
- `variant` and `commercial` must be objects with known keys only.
- Raw payloads combined with the row JSON must not exceed 128 KiB.
- Inventory quantities must be non-negative integers. Other numeric commercial
  fields must be finite and non-negative; `discounted_unit_price` may be null.
  `restock_date` is null or `YYYY-MM-DD`.

### Behavior

The endpoint resolves `product_variants` by case-insensitive `item_code` match
in batched reads. Missing or changed variants are written in one batch via upsert on `sku`
with `sku=item_code`, `item_code`, `variant_name`, `color`, `material`,
`status=active`, and merged, namespaced raw payload. Existing unrelated payload
keys are preserved and the row hash prevents unchanged variant writes.
After creation, all variants are re-read; if canonical identities remain missing
or ambiguous the entire request fails with 502.

A `source_import_runs` row is resolved using a bounded read-before-write by
`source_system + file_hash(run_key)`. The `source_file` is set to
`saved:<window_start>/<window_end>`. Window and bootstrap metadata are stored.
Upon replay with an identical run key, the existing run is returned.

Product commercials are upserted on `variant_id`
with whitelisted fields plus `sync_status=synced` and
`last_sync_success_at=window_end`. The Giga raw payload is namespaced under
`gigab2b_saved` while preserving unrelated payload. Only after commercial state
is durable are `source_import_rows` upserted on `(run_id, row_index)` with
`normalized_status=succeeded`.

The run is finalized with `status=succeeded`, `row_count`, and `finished_at`.

### Idempotency

Rows replaying with the same run key and identical row hashes return `unchanged`
without rewriting data. Rows with new or changed hashes return `created` or
`updated`.

### Response

HTTP 200 with results in ascending `row_index` order:

```json
{
  "results": [
    {"row_index": 1, "item_code": "N511P407695W", "variant_id": "uuid", "result": "created"},
    {"row_index": 2, "item_code": "MISSING", "error": "variant_not_found"}
  ]
}
```

### Error responses

- 400 — validation failures
- 401 — unauthorized
- 405 — method not allowed
- 502 — upstream/PostgREST failure (fail closed)
- 503 — service not configured

## Query listing candidates

`POST /api/internal/catalog/listing-candidates/query`

The bearer authentication is identical to the other internal catalog endpoints.

Request:

```json
{"item_codes": ["N511P407695W", "N511P407695B"]}
```

### Constraints

- 1–100 unique, case-insensitive item codes as non-empty strings (max 128 chars).
- Read-only — no writes to the database.

### Behavior

Batch reads `product_variants`, `product_commercials`, Mercari
`platform_listings`, and `platform_listing_skus` (position 1). No writes.

Results follow input order. Missing or ambiguous variants and missing commercial
state are per-row errors.

Each successful candidate returns canonical identity fields, variant and
commercial raw payloads, inventory/pricing fields (`source_available_qty`,
`owned_qty`, `source_unit_price`, `discounted_unit_price`, `fulfillment_fee`,
`effective_cost_price`, `effective_tcogs`, and both Mercari effective prices),
inventory status, restock date, sync freshness, and Mercari mappings for shops
shop1 through shop4. Each mapping includes `external_listing_id`,
`external_sku_id`, `sku_code`, `status`, and `queued_at`/`opened_at` timestamps
extracted from `raw_payload.catalogsync_listing_state`.

Duplicate listings per shop and multiple SKUs per listing are rejected as
`listing_mapping_conflict` per row.

### Response

HTTP 200:

```json
{
  "results": [
    {
      "variant_id": "uuid",
      "item_code": "N511P407695W",
      "variant_name": "Product Title",
      "color": "Red",
      "material": "Cotton",
      "variant_raw_payload": {},
      "commercial_raw_payload": {},
      "source_available_qty": 10,
      "owned_qty": 0,
      "source_unit_price": 1000,
      "discounted_unit_price": null,
      "fulfillment_fee": 500,
      "effective_cost_price": 1500,
      "effective_tcogs": 1500,
      "mercari_effective_price_excl_shipping": 2500,
      "mercari_effective_price_incl_shipping": 3500,
      "inventory_status": "in_stock",
      "restock_date": null,
      "sync_status": "synced",
      "last_sync_success_at": "2025-02-01T00:00:00.000Z",
      "mercari_mappings": {
        "shop1": {
          "shop_code": "shop1",
          "external_listing_id": "ext-id",
          "external_sku_id": "esk-id",
          "sku_code": "N511P407695W",
          "status": "OPENED",
          "queued_at": "2025-01-15T00:00:00.000Z",
          "opened_at": "2025-02-01T00:00:00.000Z"
        },
        "shop2": null,
        "shop3": null,
        "shop4": null
      }
    },
    {"item_code": "N511P407695B", "error": "sku_not_found"}
  ]
}
```

Per-row errors: `sku_not_found`, `duplicate_item_code`,
`commercial_state_missing`, `listing_mapping_conflict`.

### Error responses

- 400 — validation failures
- 401 — unauthorized
- 405 — method not allowed
- 502 — upstream/PostgREST failure
- 503 — service not configured

## Verification

Run `npm run test:internal-api`, `npm run typecheck:internal-api`, and
`npm run typecheck:all`. The focused tests
cover authorization, malformed/duplicate/oversize batches, missing SKUs, exact
zero preservation, absent or not-ready commercial state, duplicate identity,
unknown quantities, upstream errors, method handling, listing-state validation,
status transitions, conflict detection, idempotent retry, raw payload
preservation, source import validation and idempotency, listing candidate
query with Mercari mappings, and both table writes.
