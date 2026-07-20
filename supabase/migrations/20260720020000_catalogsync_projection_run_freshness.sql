-- Domain: product_catalog
-- Owner: retailpulses/RPagentOS
-- Affected: catalogsync_marketplace_projection_v1
-- Change class: additive
-- Hosted write required: yes
-- Consumers: retailpulses/CatalogSync Rakuten VPS
-- Issue: https://github.com/retailpulses/CatalogSync/issues/61
-- Rollback: restore the view body from 20260717130000.
--
-- Per-SKU success timestamps intentionally change only when business data
-- changes. Marketplace consumers therefore use the latest complete catalog
-- run as the source-freshness heartbeat without receiving base-table access.

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
  ppl.match_method,
  latest_run.id                  AS source_run_id,
  latest_run.finished_at         AS source_run_finished_at,
  latest_run.total_skus          AS source_run_total_skus,
  latest_run.status              AS source_run_status
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
LEFT JOIN LATERAL (
  SELECT csr.id, csr.finished_at, csr.total_skus, csr.status
  FROM public.catalog_sync_runs AS csr
  WHERE csr.status IN ('completed', 'completed_with_errors')
  ORDER BY csr.finished_at DESC
  LIMIT 1
) AS latest_run ON true
WHERE ppl.platform IN ('amazon', 'rakuten');

COMMENT ON VIEW public.catalogsync_marketplace_projection_v1 IS
  'Marketplace projection with run-level source freshness; SELECT-only for dedicated CatalogSync workload identities.';

REVOKE ALL ON public.catalogsync_marketplace_projection_v1 FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO catalogsync_marketplace_reader;
GRANT SELECT ON public.catalogsync_marketplace_projection_v1 TO catalogsync_marketplace_reader;

NOTIFY pgrst, 'reload schema';
