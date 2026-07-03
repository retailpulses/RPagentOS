# Listing Audit Package

Deterministic listing audit module for RPagentOS. It turns local listing exports
into reviewable listing quality results without calling platform APIs or LLMs.

## Inputs

The loader accepts JSON arrays or CSV files. It recognizes common listing fields:

- `external_listing_id`, `listing_id`, or `id`
- `platform`, `shop_code`, `sku`
- `listing_title`, `title`, or `product_title`
- `description`
- `current_price` or `price`
- `stock_qty` or `stock`
- `listing_status`, `category`, `url`
- `image_urls` or `image_paths` as `|` or `;` separated CSV values

## Run

```bash
npm run job:audit-listings
npm run job:audit-listings -- --file=data/listing-audit-samples/listings.csv
```

Default output is written to `outputs/listing-audit/`:

- `audit-results.json`
- `audit-results.jsonl`

## Current Scope

This is a rules package, not an executor. It flags title, description, image, and
pricing/stock issues and returns a human-review recommendation. It does not edit
listings or call marketplace APIs.
