-- Domain: product_catalog
-- Owner: retailpulses/RPagentOS
-- Affected: product_commercials.manual_cost_price,
--           product_commercials.baseline_price,
--           product_commercials.rma_rate,
--           compute_effective_cost_price(numeric, numeric, numeric, numeric)
-- Change class: additive
-- Hosted write required: yes
-- Consumers: retailpulses/CatalogSync, retailpulses/skills:sync-giga-saved-products,
--            retailpulses/skills:mercari-csv-listing
--
-- RPagentOS#127 recovered these authoritative definitions from CatalogSync
-- commits b57f6dc and 727e6a9. They match the July 15-18 incident evidence in
-- rp-governance-kit#32 and the inputs used by RPagentOS PR #46. The original
-- Phase A deployment was present in the shared hosted schema but absent from
-- the canonical RPagentOS migration stream.
--
-- This unique owner migration sorts immediately before the first canonical
-- dependent migration (20260718000000). Every statement is idempotent against
-- the existing hosted objects; this PR performs no hosted write.

ALTER TABLE public.product_commercials
    ADD COLUMN IF NOT EXISTS baseline_price numeric;

ALTER TABLE public.product_commercials
    ADD COLUMN IF NOT EXISTS manual_cost_price numeric;

ALTER TABLE public.product_commercials
    ADD COLUMN IF NOT EXISTS rma_rate text;

-- Exact precedence from CatalogSync commit b57f6dc:
-- manual -> baseline -> discounted -> source, ignoring zero at every step.
CREATE OR REPLACE FUNCTION public.compute_effective_cost_price(
    p_manual_cost_price numeric,
    p_baseline_price numeric,
    p_discounted_unit_price numeric,
    p_source_unit_price numeric
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $function$
BEGIN
    RETURN COALESCE(
        NULLIF(p_manual_cost_price, 0),
        NULLIF(p_baseline_price, 0),
        NULLIF(p_discounted_unit_price, 0),
        NULLIF(p_source_unit_price, 0)
    );
END;
$function$;

-- Forward recovery: re-run this migration; all definitions are idempotent.
-- Rollback: none. These objects predate this reconciliation and are required by
-- 20260718000000_add_mercari_pricing_trigger.sql and later consumers.
