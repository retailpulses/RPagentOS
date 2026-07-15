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

## Verification

Run `npm run test:internal-api`, `npm run typecheck:internal-api`, and
`npm run typecheck:all`. The focused tests
cover authorization, malformed/duplicate/oversize batches, missing SKUs, exact
zero preservation, absent or not-ready commercial state, duplicate identity,
unknown quantities, upstream errors, and method handling.
