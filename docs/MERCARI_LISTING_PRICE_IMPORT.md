# Mercari Shops Listing Price CSV Import

## Purpose

`scripts/import_mercari_listing_prices.py` imports two owner-managed listing fields
from official Mercari Shops CSV exports:

- `現在価格` → `platform_listings.current_price`
- `値引き前の価格` → `platform_listings.mercari_before_discount_price`

It does not call Mercari and does not change inventory, SKUs, or listing status.

## Required environment

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Run only from an approved owner-operated environment. Do not pass credentials on
the command line or commit them.

## Workflow

Always inspect the default dry-run first:

```bash
python3 scripts/import_mercari_listing_prices.py \
  --shop-code shop4 \
  --csv /path/to/timesale_update.csv \
  --report /tmp/shop4-price-dry-run.json
```

Review `changes`, `matched_listings`, and the examples. Apply with an explicit
upper bound equal to the reviewed change count:

```bash
python3 scripts/import_mercari_listing_prices.py \
  --shop-code shop4 \
  --csv /path/to/timesale_update.csv \
  --apply \
  --max-changes 88 \
  --report /tmp/shop4-price-apply.json
```

The importer filters Mercari template rows whose processing flag starts with
`#`, rejects duplicate or missing listing IDs, updates changed rows only, verifies
the first five writes before continuing, and performs a final exact readback of
the complete CSV scope. Re-running the same CSV should report zero changes.
Repeat `--csv` to combine update and registration exports for one shop. The
importer rejects duplicate listing IDs across those files.
Use repeatable `--exclude-listing-id` only for reviewed non-product fee or
shipping-adjustment records that are intentionally absent from the catalog.

The 2026-09-05 production dry-run read 2,255 listings in 23 bounded requests and
received 363,191 response bytes. Investigate runs above 5 MB and stop at 10 MB.

## Version history

- 2026-09-05: Initial reusable dry-run/apply workflow under RPagentOS#113.
- 2026-09-05: Added explicit Shop1-Shop4 selection and multiple CSV inputs under RPagentOS#115.
