-- Domain: product_catalog
-- Owner: retailpulses/RPagentOS
-- Affected: catalogsync_mercari_listing_map_v1,
--           catalogsync_mercari_shop4_listing_map_v1
-- Change class: additive
-- Hosted write required: yes
-- Consumers: retailpulses/CatalogSync weekly Mercari coverage diagnostic
-- Purpose: expose owner-managed listing price observations through the existing
--          shop-isolated, read-only CatalogSync PostgREST boundaries.
-- Rollback: re-create both views without the two trailing price columns. Base
--           platform_listings price data is preserved.

BEGIN;

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
    listing_sku.external_sku_id,
    listing.current_price,
    listing.mercari_before_discount_price
FROM public.platform_accounts AS account
JOIN public.platform_listings AS listing
    ON listing.platform_account_id = account.id
JOIN public.platform_listing_skus AS listing_sku
    ON listing_sku.listing_id = listing.id
WHERE lower(btrim(account.platform)) = 'mercari'
  AND lower(btrim(account.shop_code)) = 'shop4'
  AND lower(btrim(account.status)) = 'active'
  AND lower(btrim(listing.shop_code)) = 'shop4';

CREATE OR REPLACE VIEW public.catalogsync_mercari_listing_map_v1
WITH (security_barrier = true)
AS
SELECT
    account.id                AS account_id,
    account.platform,
    account.shop_code         AS account_shop_code,
    account.status            AS account_status,
    listing.id                AS listing_id,
    listing.external_listing_id,
    listing.variant_id        AS listing_variant_id,
    listing.shop_code         AS listing_shop_code,
    listing.listing_status,
    listing_sku.variant_id    AS listing_sku_variant_id,
    listing_sku.sku_code,
    listing_sku.seller_sku,
    listing_sku.external_sku_id,
    listing.current_price,
    listing.mercari_before_discount_price
FROM public.platform_accounts AS account
JOIN public.platform_listings AS listing
    ON listing.platform_account_id = account.id
JOIN public.platform_listing_skus AS listing_sku
    ON listing_sku.listing_id = listing.id
WHERE lower(btrim(account.platform)) = 'mercari'
  AND lower(btrim(account.status)) = 'active'
  AND lower(btrim(account.shop_code)) = (
      CASE current_user
          WHEN 'catalogsync_shop1_reader' THEN 'shop1'
          WHEN 'catalogsync_shop2_reader' THEN 'shop2'
          WHEN 'catalogsync_shop3_reader' THEN 'shop3'
          ELSE NULL
      END
  )
  AND lower(btrim(listing.shop_code)) = (
      CASE current_user
          WHEN 'catalogsync_shop1_reader' THEN 'shop1'
          WHEN 'catalogsync_shop2_reader' THEN 'shop2'
          WHEN 'catalogsync_shop3_reader' THEN 'shop3'
          ELSE NULL
      END
  );

ALTER VIEW public.catalogsync_mercari_shop4_listing_map_v1 OWNER TO postgres;
ALTER VIEW public.catalogsync_mercari_listing_map_v1 OWNER TO postgres;

REVOKE ALL ON public.catalogsync_mercari_shop4_listing_map_v1 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.catalogsync_mercari_listing_map_v1 FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.catalogsync_mercari_shop4_listing_map_v1
    TO catalogsync_shop4_reader;
GRANT SELECT ON public.catalogsync_mercari_listing_map_v1
    TO catalogsync_shop1_reader, catalogsync_shop2_reader, catalogsync_shop3_reader;

COMMENT ON VIEW public.catalogsync_mercari_shop4_listing_map_v1 IS
    'Shop4-isolated listing mapping and owner-managed price observations for CatalogSync read-only workloads.';
COMMENT ON VIEW public.catalogsync_mercari_listing_map_v1 IS
    'Role-isolated Shop1-Shop3 listing mapping and owner-managed price observations for CatalogSync read-only workloads.';

NOTIFY pgrst, 'reload schema';

COMMIT;
