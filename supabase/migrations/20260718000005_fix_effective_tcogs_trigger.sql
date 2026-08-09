-- Domain: product_catalog
-- Owner: retailpulses/RPagentOS
-- Affected: trg_product_commercials_pricing (function body), product_commercials (data)
-- Change class: additive
-- Hosted write required: yes (backfill UPDATE)
-- Consumers: retailpulses/OrderMgmt (Portal margin calc via effective_tcogs),
--            retailpulses/skills:sync-giga-saved-products,
--            retailpulses/skills:mercari-csv-listing
--
-- Purpose:
--   Fix a design gap in the pricing trigger deployed in 20260718000000:
--   trg_product_commercials_pricing computes effective_cost_price and
--   mercari_effective_price_incl_shipping, but does NOT update effective_tcogs.
--   effective_tcogs was backfilled once during the Supabase migration and
--   thereafter frozen — never recomputed when cost or fulfillment_fee changed.
--
--   This migration:
--     1. Adds effective_tcogs computation to the trigger function (one line).
--     2. Backfills existing rows where effective_tcogs is stale.
--
--   Formula: effective_tcogs = effective_cost_price + fulfillment_fee
--   (same formula used by compute_mercari_price_incl_shipping internally).
--
-- Rollback:
--   CREATE OR REPLACE FUNCTION to the prior body (see 20260718000000).
--   The backfill UPDATE is idempotent and value-correct — no rollback needed
--   for data.
--
-- Forward recovery:
--   After this migration, every INSERT or UPDATE of source_unit_price,
--   fulfillment_fee, baseline_price, discounted_unit_price, manual_cost_price,
--   or rma_rate will recompute effective_tcogs. Future product master imports
--   will automatically keep effective_tcogs in sync.

-- ── 1. Update trigger function to set effective_tcogs ─────────────

CREATE OR REPLACE FUNCTION public.trg_product_commercials_pricing()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
    BEGIN
        -- Compute effective_cost_price from source fields
        NEW.effective_cost_price := public.compute_effective_cost_price(
            NEW.manual_cost_price,
            NEW.baseline_price,
            NEW.discounted_unit_price,
            NEW.source_unit_price
        );

        -- Compute effective_tcogs = effective_cost_price + fulfillment_fee
        NEW.effective_tcogs := NEW.effective_cost_price + COALESCE(NEW.fulfillment_fee, 0);

        -- Compute Mercari effective price (incl. shipping)
        IF NEW.source_unit_price IS NOT NULL
           AND NEW.source_unit_price > 0
           AND NEW.fulfillment_fee IS NOT NULL
        THEN
            NEW.mercari_effective_price_incl_shipping := public.compute_mercari_price_incl_shipping(
                NEW.source_unit_price,
                NEW.fulfillment_fee,
                NEW.effective_cost_price,
                NEW.rma_rate
            );
        END IF;

        RETURN NEW;
    END;
$function$;

-- ── 2. Backfill existing stale rows ──────────────────────────────

-- Only touches rows where effective_tcogs diverges from the computed value.
-- Uses IS DISTINCT FROM to handle NULL comparisons correctly.

UPDATE product_commercials
SET effective_tcogs = effective_cost_price + COALESCE(fulfillment_fee, 0)
WHERE effective_cost_price IS NOT NULL
  AND effective_tcogs IS DISTINCT FROM (effective_cost_price + COALESCE(fulfillment_fee, 0));
