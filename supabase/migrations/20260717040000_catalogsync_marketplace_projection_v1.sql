-- Domain: product_catalog
-- Owner: retailpulses/RPagentOS
-- Affected: catalogsync_marketplace_projection_v1, catalogsync_marketplace_reader
-- Change class: additive
-- Hosted write required: yes
-- Consumers: retailpulses/CatalogSync
-- Issue: https://github.com/retailpulses/RPagentOS/issues/32
-- Rollback: revoke the role grant, drop the view, then drop the NOLOGIN role.

-- Dedicated PostgREST role. It can be selected only by a JWT whose role claim
-- is catalogsync_marketplace_reader and has no base-table privileges.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catalogsync_marketplace_reader') THEN
    EXECUTE 'CREATE ROLE catalogsync_marketplace_reader NOLOGIN NOBYPASSRLS';
  END IF;
END
$$;

ALTER ROLE catalogsync_marketplace_reader NOLOGIN NOBYPASSRLS;
ALTER ROLE catalogsync_marketplace_reader SET statement_timeout = '10s';

-- These catalog-sync freshness fields already exist in the hosted contract but
-- were not yet reproducible from RPagentOS main. Adopt only the two fields
-- required by this projection; IF NOT EXISTS keeps hosted application safe.
ALTER TABLE public.product_commercials
  ADD COLUMN IF NOT EXISTS sync_status text;
ALTER TABLE public.product_commercials
  ADD COLUMN IF NOT EXISTS last_sync_success_at timestamptz;

CREATE INDEX IF NOT EXISTS ix_product_platform_links_platform_variant
  ON public.product_platform_links (platform, variant_id);
CREATE INDEX IF NOT EXISTS ix_product_platform_links_listing_platform
  ON public.product_platform_links (listing_id, platform);
CREATE INDEX IF NOT EXISTS ix_platform_listings_platform_manage_status
  ON public.platform_listings (platform, manage_number, listing_status);

CREATE OR REPLACE VIEW public.catalogsync_marketplace_projection_v1
WITH (security_barrier = true)
AS
SELECT
  ppl.id                         AS projection_row_id,
  pv.id                          AS product_variant_id,
  pv.item_code,
  pv.status                      AS product_status,
  pc.source_available_qty,
  pc.owned_qty,
  pc.presale_qty,
  pc.restock_date,
  pc.inventory_status,
  pc.sync_status,
  pc.last_sync_success_at,
  pc.updated_at                  AS inventory_updated_at,
  ppl.platform,
  ppl.shop_code,
  pa.seller_account_id           AS account_id,
  pa.shop_code                   AS marketplace_id,
  pa.shop_code                   AS shop_id,
  pa.status                      AS account_status,
  pl.id                          AS listing_id,
  pl.external_listing_id,
  pl.manage_number,
  pl.listing_status,
  pl.updated_at                  AS listing_updated_at,
  pls.id                         AS listing_sku_id,
  pls.seller_sku,
  pls.sku_code,
  COALESCE(pls.external_sku_id, pls.sku_code) AS marketplace_variant_id,
  pls.sku_status,
  pls.updated_at                 AS mapping_updated_at,
  ppl.match_method
FROM public.product_platform_links AS ppl
JOIN public.product_variants AS pv
  ON pv.id = ppl.variant_id
JOIN public.product_commercials AS pc
  ON pc.variant_id = pv.id
JOIN public.platform_listings AS pl
  ON pl.id = ppl.listing_id
JOIN public.platform_listing_skus AS pls
  ON pls.id = ppl.listing_sku_id
JOIN public.platform_accounts AS pa
  ON pa.id = pl.platform_account_id
WHERE ppl.platform IN ('amazon', 'rakuten');

COMMENT ON VIEW public.catalogsync_marketplace_projection_v1 IS
  'Marketplace-specific read projection owned by RPagentOS and consumed by the CatalogSync Worker through a declared PostgREST workload.';

REVOKE ALL ON public.catalogsync_marketplace_projection_v1 FROM PUBLIC;
REVOKE ALL ON public.catalogsync_marketplace_projection_v1 FROM anon;
REVOKE ALL ON public.catalogsync_marketplace_projection_v1 FROM authenticated;

GRANT USAGE ON SCHEMA public TO catalogsync_marketplace_reader;
GRANT SELECT ON public.catalogsync_marketplace_projection_v1 TO catalogsync_marketplace_reader;

-- Supabase PostgREST connects as authenticator and may SET ROLE only to roles
-- explicitly granted here. This grants no table privilege to authenticator.
GRANT catalogsync_marketplace_reader TO authenticator;
