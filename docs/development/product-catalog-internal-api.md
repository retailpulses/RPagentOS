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

## Verification

Run `npm run test:internal-api`, `npm run typecheck:internal-api`, and
`npm run typecheck:all`. The focused tests
cover authorization, malformed/duplicate/oversize batches, missing SKUs, exact
zero preservation, absent or not-ready commercial state, duplicate identity,
unknown quantities, upstream errors, method handling, listing-state validation,
status transitions, conflict detection, idempotent retry, raw payload
preservation, and both table writes.
