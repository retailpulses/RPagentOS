-- Domain: product_catalog
-- Owner: retailpulses/RPagentOS
-- Affected: catalogsync_marketplace_projection_v1
-- Change class: additive
-- Hosted write required: yes
-- Consumers: retailpulses/CatalogSync
-- Issue: https://github.com/retailpulses/RPagentOS/issues/32
-- Rollback: restore prior view body without COALESCE on owned_qty

-- The product_commercials.owned_qty column may be NULL for rows where
-- warehouse-owned inventory has never been recorded. The Worker API
-- tolerates NULL and normalizes to 0, but the view should produce
-- clean data at the source. This migration adds COALESCE for owned_qty
-- to match the existing presale_qty guard added in migration 20260717130000.
CREATE OR REPLACE VIEW public.catalogsync_marketplace_projection_v1
WITH (security_barrier = true)
AS
SELECT
  ppl.id                         AS projection_row_id,
  pv.id                          AS product_variant_id,
  pv.item_code,
  pv.status                      AS product_status,
  pc.source_available_qty,
  COALESCE(pc.owned_qty, 0)      AS owned_qty,
  COALESCE(pc.presale_qty, 0)    AS presale_qty,
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
  COALESCE(pls.sku_status, '')   AS sku_status,
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
