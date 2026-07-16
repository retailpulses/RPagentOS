-- Domain: product_catalog
-- Owner: retailpulses/RPagentOS
-- Affected: product_commercials,
--           catalogsync_mercari_shop4_listing_map_v1,
--           catalogsync_mercari_shop4_catalog_v1,
--           catalogsync_shop4_reader
-- Change class: additive
-- Hosted write required: yes
-- Consumers: retailpulses/CatalogSync
--
-- Purpose:
-- Provide the CatalogSync Mercari shop4 VPS workload with a dedicated,
-- read-only PostgREST boundary. The role receives no base-table privileges and
-- cannot read another shop through the exposed listing projection.
--
-- Runtime contract:
-- - JWT role claim: catalogsync_shop4_reader
-- - GET/SELECT only
-- - 20 second statement timeout
-- - no service_role credential in CatalogSync
--
-- Forward recovery:
-- Revoke catalogsync_shop4_reader from authenticator, revoke view access, drop
-- both views, then drop the NOLOGIN role. Base tables and data are unchanged.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_roles
        WHERE rolname = 'catalogsync_shop4_reader'
    ) THEN
        CREATE ROLE catalogsync_shop4_reader
            NOLOGIN
            NOINHERIT
            NOCREATEDB
            NOCREATEROLE
            NOSUPERUSER
            NOREPLICATION
            NOBYPASSRLS;
    END IF;
END
$$;

ALTER ROLE catalogsync_shop4_reader
    SET statement_timeout = '20s';

GRANT catalogsync_shop4_reader TO authenticator;
GRANT USAGE ON SCHEMA public TO catalogsync_shop4_reader;

-- Hosted product_commercials already carries this CatalogSync signal. Adopt it
-- in the owner migration chain so fresh replay matches the hosted contract.
ALTER TABLE public.product_commercials
    ADD COLUMN IF NOT EXISTS mercari_sync_needed BOOLEAN;

CREATE OR REPLACE VIEW public.catalogsync_mercari_shop4_listing_map_v1
WITH (security_barrier = true)
AS
SELECT
    account.id AS account_id,
    account.platform,
    account.shop_code AS account_shop_code,
    account.status AS account_status,
    listing.id AS listing_id,
    listing.external_listing_id,
    listing.variant_id AS listing_variant_id,
    listing.shop_code AS listing_shop_code,
    listing.listing_status,
    listing_sku.variant_id AS listing_sku_variant_id,
    listing_sku.sku_code,
    listing_sku.seller_sku,
    listing_sku.external_sku_id
FROM public.platform_accounts AS account
JOIN public.platform_listings AS listing
    ON listing.platform_account_id = account.id
JOIN public.platform_listing_skus AS listing_sku
    ON listing_sku.listing_id = listing.id
WHERE lower(btrim(account.platform)) = 'mercari'
  AND lower(btrim(account.shop_code)) = 'shop4'
  AND lower(btrim(account.status)) = 'active'
  AND lower(btrim(listing.shop_code)) = 'shop4';

CREATE OR REPLACE VIEW public.catalogsync_mercari_shop4_catalog_v1
WITH (security_barrier = true)
AS
SELECT
    variant.id AS variant_id,
    variant.item_code,
    variant.status AS variant_status,
    commercial.source_available_qty,
    commercial.owned_qty,
    commercial.restock_date,
    commercial.inventory_status,
    commercial.mercari_sync_needed,
    commercial.updated_at,
    commercial.mercari_effective_price_excl_shipping,
    commercial.mercari_effective_price_incl_shipping
FROM public.product_variants AS variant
LEFT JOIN public.product_commercials AS commercial
    ON commercial.variant_id = variant.id;

ALTER VIEW public.catalogsync_mercari_shop4_listing_map_v1 OWNER TO postgres;
ALTER VIEW public.catalogsync_mercari_shop4_catalog_v1 OWNER TO postgres;

REVOKE ALL ON public.catalogsync_mercari_shop4_listing_map_v1 FROM PUBLIC;
REVOKE ALL ON public.catalogsync_mercari_shop4_catalog_v1 FROM PUBLIC;
REVOKE ALL ON public.catalogsync_mercari_shop4_listing_map_v1 FROM anon, authenticated;
REVOKE ALL ON public.catalogsync_mercari_shop4_catalog_v1 FROM anon, authenticated;

GRANT SELECT ON public.catalogsync_mercari_shop4_listing_map_v1
    TO catalogsync_shop4_reader;
GRANT SELECT ON public.catalogsync_mercari_shop4_catalog_v1
    TO catalogsync_shop4_reader;

COMMENT ON VIEW public.catalogsync_mercari_shop4_listing_map_v1 IS
    'Owner-managed, shop4-isolated listing mapping projection for the CatalogSync VPS.';
COMMENT ON VIEW public.catalogsync_mercari_shop4_catalog_v1 IS
    'Owner-managed, column-limited catalog projection for the CatalogSync Mercari shop4 workload.';
COMMENT ON ROLE catalogsync_shop4_reader IS
    'NOLOGIN JWT role for read-only CatalogSync Mercari shop4 PostgREST access.';

NOTIFY pgrst, 'reload schema';
