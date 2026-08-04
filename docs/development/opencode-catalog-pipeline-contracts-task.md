# Bounded OpenCode implementation task: source import and listing candidates

Implement two additional authenticated product-catalog owner endpoints for the
GigaB2B marketplace listing pipeline. Do not access credentials, databases,
network, or production; do not deploy or create migrations. Reuse the existing
internal catalog authentication and PostgREST helpers. Keep changes to the
internal API handler, two Pages routes, focused tests, package/tsconfig test
registration, and `docs/development/product-catalog-internal-api.md`.

## 1. `POST /api/internal/catalog/source-imports/batch`

Request has exactly `run` and `rows`:

```json
{
  "run": {
    "source_system": "gigab2b_saved",
    "window_start": "ISO timestamp",
    "window_end": "ISO timestamp",
    "run_key": "sha256/stable key",
    "is_bootstrap": true
  },
  "rows": [{
    "row_index": 1,
    "item_code": "SKU",
    "source_added_at": "ISO timestamp",
    "source_updated_at": "ISO timestamp or null",
    "row_hash": "sha256",
    "variant": {
      "variant_name": "title",
      "color": "value or null",
      "material": "value or null",
      "raw_payload": {}
    },
    "commercial": {
      "source_available_qty": 1,
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

Requirements:

- 1..100 rows; strict unknown-key rejection, bounded strings/metadata (raw JSON
  maximum 128 KiB per row), unique positive row indexes and case-insensitive
  item codes, timezone-aware timestamps, and `window_start < window_end`.
- `source_system` must be `gigab2b_saved`. Ensure each source timestamp is
  inside or before the captured window end; reject future/leaking rows.
- Resolve variants case-insensitively in batched reads. Create missing variants
  in one batch with `sku=item_code`, `item_code`, `variant_name`, color,
  material, status active, and namespaced raw payload. Upsert by `sku`; re-read
  all variants after creation and fail the whole request with 502 if canonical
  identities remain missing/ambiguous.
- Upsert commercials by `variant_id`, set supplied whitelisted values plus
  `sync_status=synced`, `last_sync_success_at=window_end`, and merge Giga raw
  payload without accepting arbitrary database columns.
- Reuse or create one `source_import_runs` row identified by
  `source_system + file_hash(run_key)` using a bounded read before write;
  `source_file` is `saved:<window_start>/<window_end>`. Store window/bootstrap
  in metadata. One pipeline lock guarantees a single caller; still make replay
  change-aware and return the existing run when found.
- Upsert `source_import_rows` on `(run_id,row_index)` with source key, row hash,
  raw row, and `normalized_status=succeeded`.
- Finish the run as `succeeded`, with row count and finished timestamp. A replay
  with the same run key and identical row hashes returns `unchanged` per row.
- Use bounded reads/writes, no N+1. Return input-ordered results with canonical
  item code, variant ID, and `created|updated|unchanged`.
- Any systemic/read/write failure returns 502. Do not expose service-role data.

## 2. `POST /api/internal/catalog/listing-candidates/query`

Request: `{"item_codes":[...]}` with 1..100 unique case-insensitive codes.

- Batch read `product_variants`, `product_commercials`, Mercari
  `platform_listings`, and `platform_listing_skus`; no writes.
- Return input order. Missing/ambiguous identity and missing commercial state are
  per-row errors.
- Each successful candidate returns canonical `variant_id`, `item_code`,
  `variant_name`, `color`, `material`, variant and commercial raw payload,
  inventory/pricing fields used by the scorer, sync freshness, and existing
  Mercari mappings for shop1..shop4 with external listing ID, external SKU ID,
  SKU, status, and queued/opened timestamps extracted from
  `raw_payload.catalogsync_listing_state`.
- Reject duplicate listing/SKU mappings as a per-row `listing_mapping_conflict`.
- Never invent category, images, description, price, or score fields; callers
  derive those only from returned canonical/raw data and fail closed if absent.

Add comprehensive mock-fetch tests for validation, bounded batching, replay,
new/existing variants, raw payload namespacing, mapping conflicts, exact zero,
and owner failures. `npm run test:internal-api` and
`npm run typecheck:internal-api` must pass. Do not modify unrelated files.
