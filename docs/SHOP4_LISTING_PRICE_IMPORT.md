# Shop4 Listing Price CSV Import

## Purpose

`scripts/import_shop4_listing_prices.py` imports two owner-managed listing fields
from an official Mercari Shop4 CSV export:

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
python3 scripts/import_shop4_listing_prices.py \
  --csv /path/to/timesale_update.csv \
  --report /tmp/shop4-price-dry-run.json
```

Review `changes`, `matched_listings`, and the examples. Apply with an explicit
upper bound equal to the reviewed change count:

```bash
python3 scripts/import_shop4_listing_prices.py \
  --csv /path/to/timesale_update.csv \
  --apply \
  --max-changes 88 \
  --report /tmp/shop4-price-apply.json
```

The importer filters Mercari template rows whose processing flag starts with
`#`, rejects duplicate or missing listing IDs, updates changed rows only, verifies
the first five writes before continuing, and performs a final exact readback of
the complete CSV scope. Re-running the same CSV should report zero changes.

## Version history

- 2026-09-05: Initial reusable dry-run/apply workflow under RPagentOS#113.
