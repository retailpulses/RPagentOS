-- Domain: product_catalog
-- Owner: retailpulses/RPagentOS
-- Affected: product_commercials,
--           compute_mercari_price_incl_shipping (new function),
--           trg_product_commercials_pricing (new trigger function),
--           trg_pricing (new trigger)
-- Change class: additive
-- Hosted write required: yes
-- Consumers: retailpulses/CatalogSync,
--            retailpulses/skills:sync-giga-saved-products,
--            retailpulses/skills:mercari-csv-listing
--
-- Governance incident ref:
--   retailpulses/rp-governance-kit#32 — retroactive emergency-change reconciliation for
--   direct psycopg2 DDL/DML applied 2026-07-15. See Issue body for full incident
--   description, backfill row counts, and preventive controls.
--
-- Purpose:
--   Implement the Baserow 886994 Mercari pricing formula as PostgreSQL functions
--   and an automatic BEFORE INSERT/UPDATE trigger on product_commercials.
--
--   Pricing chain (mirrors Baserow 886994 production formula fields):
--     1. Effective Cost Price = first non-zero of: manual → baseline → discounted → unit price
--     2. Effective TCOGS       = Effective Cost Price + Fulfillment Fee
--     3. Prcing COE            = tiered coefficient based on source_unit_price
--     4. RMA Multiple          = risk multiplier based on rma_rate
--     5. Mercari excl.         = round((TCOGS / 0.76 × COE × RMA − Fee) / 50) × 50
--     6. Mercari incl.         = round((excl + Fee) / 50) × 50
--
--   The 0.76 divisor = 1 − 0.10(Mercari fee) − 0.12 − 0.02 = 0.76 (24% fee coverage).
--   Final prices round to the nearest ¥50 increment.
--
-- Historical backfill (already executed on hosted database):
--   These updates were applied via direct psycopg2 on 2026-07-15 and MUST NOT
--   be re-executed by this migration. Recorded here for ledger completeness.
--
--   - 108 rows: UPDATE product_commercials SET effective_cost_price =
--     compute_effective_cost_price(manual_cost_price, baseline_price,
--     discounted_unit_price, source_unit_price) WHERE effective_cost_price IS NULL
--
--   - 253 rows: UPDATE product_commercials SET mercari_effective_price_incl_shipping =
--     compute_mercari_price_incl_shipping(source_unit_price, fulfillment_fee,
--     effective_cost_price, rma_rate) WHERE fulfillment_fee IS NOT NULL
--
--   - 5,569 rows: UPDATE product_commercials SET mercari_effective_price_incl_shipping = NULL
--     WHERE mercari_effective_price_incl_shipping IS NOT NULL
--     AND fulfillment_fee IS NULL
--     (Cleanup after an initial erroneous backfill that computed prices for rows
--      that should have been NULL — no fulfillment_fee → no valid TCOGS.)
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_pricing ON product_commercials;
--   DROP FUNCTION IF EXISTS trg_product_commercials_pricing();
--   DROP FUNCTION IF EXISTS compute_mercari_price_incl_shipping(numeric, numeric, numeric, text);
--   (compute_effective_cost_price is retained — it was deployed in a prior migration.)
--
-- Forward recovery:
--   Trigger recomputes effective_cost_price and mercari_effective_price_incl_shipping
--   on every INSERT or targeted-column UPDATE. No data loss risk.
--
-- Migration ledger note:
--   The live objects were created directly on the hosted database on 2026-07-15.
--   This migration is the canonical backfill migration per DATABASE_GOVERNANCE.md §10
--   (emergency-change reconciliation: idempotent CREATE OR REPLACE + DROP IF EXISTS).
--   After this migration is applied, supabase_migrations.schema_migrations will
--   record 20260718000000 and the ledger will be consistent with the hosted schema.

-- ── 1. Mercari Price Computation Function ──────────────────────

CREATE OR REPLACE FUNCTION public.compute_mercari_price_incl_shipping(
    p_source_unit_price numeric,
    p_fulfillment_fee numeric,
    p_effective_cost_price numeric,
    p_rma_rate text DEFAULT NULL::text
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $function$
    DECLARE
        v_effective_tcogs numeric;
        v_prcing_coe numeric;
        v_rma_multiple numeric;
        v_mercari_excl numeric;
        v_mercari_incl numeric;
    BEGIN
        -- Guard: need cost price and shipping fee
        IF p_effective_cost_price IS NULL OR p_effective_cost_price <= 0 THEN
            RETURN NULL;
        END IF;
        IF p_fulfillment_fee IS NULL THEN
            RETURN NULL;
        END IF;

        -- Effective TCOGS = Effective Cost Price + Shipping Fee
        v_effective_tcogs := p_effective_cost_price + p_fulfillment_fee;

        -- Pricing COE (tiered coefficient based on Unit Price)
        v_prcing_coe := CASE
            WHEN p_source_unit_price > 12000 THEN 0.98
            WHEN p_source_unit_price > 8000  THEN 1.00
            WHEN p_source_unit_price < 3000  THEN 1.05
            ELSE 1.02
        END;

        -- RMA Multiple
        v_rma_multiple := CASE
            WHEN p_rma_rate = 'High'     THEN 1.1
            WHEN p_rma_rate = 'Moderate' THEN 1.06
            ELSE 1.0
        END;

        -- Mercari Effective Pricing (excl. shipping)
        -- = round((Effective TCOGS / 0.76 * Prcing COE * RMA Multiple - Shipping Fee) / 50) * 50
        v_mercari_excl := round((
            (v_effective_tcogs / 0.76) * v_prcing_coe * v_rma_multiple
            - p_fulfillment_fee
        ) / 50) * 50;

        -- Mercari Effective Pricing (incl. shipping)
        -- = round((excl + Shipping Fee) / 50) * 50
        v_mercari_incl := round((v_mercari_excl + p_fulfillment_fee) / 50) * 50;

        RETURN GREATEST(v_mercari_incl, 0);
    END;
    $function$;

-- ── 2. Trigger Function ────────────────────────────────────────

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

-- ── 3. Trigger on product_commercials ──────────────────────────

DROP TRIGGER IF EXISTS trg_pricing ON public.product_commercials;

CREATE TRIGGER trg_pricing
    BEFORE INSERT OR UPDATE OF source_unit_price, fulfillment_fee,
                           baseline_price, discounted_unit_price,
                           manual_cost_price, rma_rate
    ON public.product_commercials
    FOR EACH ROW
    EXECUTE FUNCTION trg_product_commercials_pricing();
