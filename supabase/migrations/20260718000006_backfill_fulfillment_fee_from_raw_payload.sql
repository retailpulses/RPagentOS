-- Domain: product_catalog
-- Owner: retailpulses/RPagentOS
-- Affected: product_commercials (data)
-- Change class: additive
-- Hosted write required: yes (backfill UPDATE)
-- Consumers: retailpulses/OrderMgmt (Portal margin calc via effective_tcogs),
--            retailpulses/skills:sync-giga-saved-products,
--            retailpulses/skills:mercari-csv-listing
--
-- Purpose:
--   Backfill the fulfillment_fee column from raw_payload JSONB where the
--   data already exists.  The CSV import pipeline (import-product-master.ts)
--   stores unit_fulfillment_fee_drop_shipping in raw_payload, but due to a
--   gap in the import logic, ~95.6% of rows have fulfillment_fee=NULL even
--   though the value is present in the JSONB payload.
--
--   This migration extracts the value, strips Japanese comma-formatting
--   (e.g. "1,001" → 1001), and writes it to the typed column.  The pricing
--   trigger (trg_product_commercials_pricing, updated in 20260718000005)
--   then recomputes effective_tcogs = effective_cost_price + fulfillment_fee.
--
--   Formula:
--     fulfillment_fee =
--       to_number(regexp_replace(
--         btrim(raw_payload->>'unit_fulfillment_fee_drop_shipping'),
--         '[,[:space:]]', '', 'g'
--       ), '99999999')
--
-- Safety:
--   - Only touches rows where fulfillment_fee IS NULL
--   - Only updates when raw_payload has a non-empty, non-"0" value
--   - The WHERE clause excludes already-populated rows (idempotent)
--
-- Rollback:
--   No practical rollback — the data being written is correct (extracted
--   from the authoritative raw_payload).  If needed, set fulfillment_fee
--   back to NULL for the affected rows:
--     UPDATE product_commercials
--     SET fulfillment_fee = NULL
--     WHERE fulfillment_fee IS NOT NULL
--       AND id IN (<row IDs from audit>);
--
-- Audit:
--   Before applying, preview affected rows:
--     SELECT COUNT(*)
--     FROM product_commercials
--     WHERE fulfillment_fee IS NULL
--       AND raw_payload IS NOT NULL
--       AND nullif(btrim(raw_payload->>'unit_fulfillment_fee_drop_shipping'), '') IS NOT NULL
--       AND nullif(btrim(raw_payload->>'unit_fulfillment_fee_drop_shipping'), '0') IS NOT NULL;
--
--   After applying, verify:
--     SELECT COUNT(*)
--     FROM product_commercials
--     WHERE fulfillment_fee IS NULL
--       AND raw_payload IS NOT NULL
--       AND nullif(btrim(raw_payload->>'unit_fulfillment_fee_drop_shipping'), '') IS NOT NULL
--       AND nullif(btrim(raw_payload->>'unit_fulfillment_fee_drop_shipping'), '0') IS NOT NULL;
--     -- Should return 0 (or only rows with unparseable values)

-- ── 1. Backfill fulfillment_fee from raw_payload ───────────────────

UPDATE product_commercials
SET fulfillment_fee = to_number(
      regexp_replace(
        btrim(raw_payload->>'unit_fulfillment_fee_drop_shipping'),
        '[,[:space:]]', '', 'g'
      ),
      '99999999'
    )
WHERE fulfillment_fee IS NULL
  AND raw_payload IS NOT NULL
  AND nullif(btrim(raw_payload->>'unit_fulfillment_fee_drop_shipping'), '') IS NOT NULL
  AND nullif(btrim(raw_payload->>'unit_fulfillment_fee_drop_shipping'), '0') IS NOT NULL;

-- ── 2. Verify effective_tcogs is now correct ───────────────────────

-- The trigger (trg_product_commercials_pricing) fires on UPDATE OF
-- fulfillment_fee, so effective_tcogs is recomputed automatically.
-- Rows where effective_tcogs was previously wrong are now correct.

-- Any rows with parse failures (non-numeric values in raw_payload) will
-- remain unchanged — they can be investigated separately.
