-- ── Mercari Pricing Consistency Audit Query ──────────────────
-- Domain: product_catalog
-- Owner: retailpulses/RPagentOS
-- Change class: diagnostics (read-only)
-- Hosted write required: no
-- Purpose: Verify compute_effective_cost_price and
--          compute_mercari_price_incl_shipping consistency across
--          all product_commercials rows. Safe to run at any time;
--          no data mutation.
--
-- Usage:
--   psql -f verify_mercari_pricing_consistency.sql
--
-- Interpretation:
--   All four counts should be 0. A non-zero count indicates
--   rows that were inserted or updated while the trigger was
--   disabled, or a logic change to the pricing functions that
--   was not followed by a full backfill.
--   Do NOT fix by bulk UPDATE — investigate the root cause first.

BEGIN;

-- 1. Rows where effective_cost_price diverges from the canonical computation
SELECT 'effective_cost_price_mismatch' AS check_name,
       count(*) AS row_count
FROM product_commercials
WHERE effective_cost_price IS DISTINCT FROM
    compute_effective_cost_price(manual_cost_price, baseline_price,
                                  discounted_unit_price, source_unit_price)

UNION ALL

-- 2. Rows that have all required inputs but NULL Mercari price
SELECT 'missing_mercari_price_despite_all_inputs' AS check_name,
       count(*) AS row_count
FROM product_commercials
WHERE fulfillment_fee IS NOT NULL
  AND source_unit_price IS NOT NULL
  AND source_unit_price > 0
  AND effective_cost_price IS NOT NULL
  AND effective_cost_price > 0
  AND mercari_effective_price_incl_shipping IS NULL

UNION ALL

-- 3. Rows with Mercari price but no fulfillment_fee (should be impossible)
SELECT 'mercari_price_without_fulfillment_fee' AS check_name,
       count(*) AS row_count
FROM product_commercials
WHERE fulfillment_fee IS NULL
  AND mercari_effective_price_incl_shipping IS NOT NULL

UNION ALL

-- 4. Rows where Mercari price is stale (different from what the function would compute)
SELECT 'mercari_price_stale_mismatch' AS check_name,
       count(*) AS row_count
FROM product_commercials
WHERE fulfillment_fee IS NOT NULL
  AND source_unit_price IS NOT NULL
  AND source_unit_price > 0
  AND effective_cost_price IS NOT NULL
  AND effective_cost_price > 0
  AND mercari_effective_price_incl_shipping IS DISTINCT FROM
      compute_mercari_price_incl_shipping(source_unit_price, fulfillment_fee,
                                           effective_cost_price, rma_rate)

UNION ALL

-- 5. Summary: row counts by pricing status
SELECT 'total_rows' AS check_name,
       count(*) AS row_count
FROM product_commercials

UNION ALL

SELECT 'rows_with_fulfillment_fee' AS check_name,
       count(*)
FROM product_commercials
WHERE fulfillment_fee IS NOT NULL

UNION ALL

SELECT 'rows_with_mercari_price' AS check_name,
       count(*)
FROM product_commercials
WHERE mercari_effective_price_incl_shipping IS NOT NULL

UNION ALL

-- 6. Trigger status check
SELECT 'trigger_trg_pricing_enabled' AS check_name,
       CASE WHEN t.tgenabled = 'O' THEN 1 ELSE 0 END AS row_count
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
WHERE t.tgname = 'trg_pricing'
  AND c.relname = 'product_commercials';

ROLLBACK;
-- ROLLBACK to guarantee no data mutation, even though these are all SELECTs.
