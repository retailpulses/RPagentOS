# Bounded OpenCode implementation task: catalog listing-state API

Implement an owner-controlled internal API endpoint for deterministic marketplace
listing state writes. This repository owns the product_catalog schema. Do not
create or edit migrations, access credentials, databases, networks, or production,
and do not deploy. Keep changes bounded to the internal API handler, one Pages
route, tests, and internal API documentation.

Endpoint:

`POST /api/internal/catalog/listing-state/batch`

Authentication/configuration must exactly reuse the existing constant-time Bearer
token checks and Supabase service-role use inside `src/api/internal-catalog.ts`.
CatalogSync callers must never receive the service-role key.

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
    "observed_at": "ISO-8601 timestamp",
    "idempotency_key": "stable caller-generated key",
    "metadata": {"score": 84, "score_config_version": "mercari-v1"}
  }]
}
```

Requirements:

- Require 1..100 updates; reject unknown keys, missing/blank strings, oversized
  values, invalid timestamp, unsupported status, duplicate identities within the
  request, non-object metadata, and metadata larger than 16 KiB.
- Supported normalized statuses: `UNOPENED`, `OPENED`, `CLOSED`, `SUSPENDED`.
- Resolve `product_variants.id` by case-insensitive exact `item_code` in bounded
  batched reads. Return per-row `variant_not_found` or `duplicate_item_code`
  without writing that row.
- Read existing `platform_listings` for the bounded platform/shop/external IDs.
  A conflicting existing mapping to a different variant/SKU must return
  `identity_conflict` and never overwrite it.
- Enforce legal transitions: missing -> any supported state;
  `UNOPENED` -> `UNOPENED|OPENED|CLOSED|SUSPENDED`;
  `OPENED` -> `OPENED|CLOSED|SUSPENDED`; `CLOSED` and `SUSPENDED` may only remain
  unchanged. Return `illegal_status_transition` otherwise.
- Upsert `platform_listings` on `(platform,shop_code,external_listing_id)` and
  `platform_listing_skus` on `(listing_id,sku_position=1)`. Populate variant ID,
  external SKU ID, sku_code/seller_sku, normalized status fields, platform
  observed timestamp, and merge caller metadata under a namespaced
  `raw_payload.catalogsync_listing_state` object without discarding unrelated
  raw payload keys. Preserve a stable queued timestamp on first `UNOPENED`; set
  opened timestamp on first `OPENED`; store idempotency key and observed time.
- Use bounded batch HTTP calls, not N+1 requests. Add generic PostgREST write
  helper(s) if needed. Use `Prefer: resolution=merge-duplicates,return=representation`.
- Response order matches input and reports `created`, `updated`, `unchanged`, or
  the per-row error. A retry with identical data and idempotency key is unchanged.
- Fail closed on upstream/systemic errors with HTTP 502 and no misleading success.
- Add comprehensive mock-fetch tests for validation, authorization, batching,
  transitions, conflict, idempotent retry, raw payload preservation, and both
  table writes. Update `docs/development/product-catalog-internal-api.md`.
- Follow existing TypeScript style and make `npm run test:internal-api` and
  `npm run typecheck:internal-api` pass.

Do not modify unrelated files. Return changed files and validation results.
