-- Domain: product_catalog
-- Owner: retailpulses/RPagentOS
-- Affected: catalogsync_mercari_listing_map_v1,
--           catalogsync_mercari_catalog_v1,
--           catalogsync_shop1_reader,
--           catalogsync_shop2_reader,
--           catalogsync_shop3_reader
-- Change class: additive
-- Hosted write required: yes
-- Consumers: retailpulses/CatalogSync Mercari shops 1-3 VPS
--
-- Purpose:
-- Extend the CatalogSync read-only PostgREST boundary to Mercari shops 1-3.
-- Each shop gets its own NOLOGIN NOBYPASSRLS role and a security-barrier
-- shared listing-map view that uses the PostgREST-set current_user to isolate
-- rows by shop. A shared catalog view exposes the same column-limited catalog
-- to all three roles.
--
-- Security model (shared listing-map view):
--   PostgREST validates the JWT and sets current_user to the role named in
--   the JWT's "role" claim. The view's WHERE clause CASE-delegates on
--   current_user to produce only rows matching that shop's shop_code. This is
--   not row-level security (RLS); it is a role-gated view-level filter that
--   cannot be bypassed by direct table access. Because the roles are NOLOGIN
--   and NOBYPASSRLS, they cannot be used as direct login roles. PostgREST's
--   authenticator may SET ROLE only after validating a JWT carrying the role.
--   A role that falls through the CASE (unrecognized current_user) receives
--   zero rows. This mechanism is additive: existing shop4 views are untouched.
--
-- Forward recovery:
-- 1. REVOKE catalogsync_shop{1,2,3}_reader FROM authenticator;
-- 2. DROP VIEW catalogsync_mercari_listing_map_v1,
--              catalogsync_mercari_catalog_v1;
-- 3. DROP OWNED BY catalogsync_shop{1,2,3}_reader CASCADE;
-- 4. DROP ROLE catalogsync_shop{1,2,3}_reader;
-- Base tables and data are unchanged. Existing shop4 views are unaffected.
--
-- Follow-up blockers (not addressed here):
-- - Supabase Auth workload identities and UUIDs for each shop must be created
--   in the Supabase Auth dashboard or via the Auth Admin API.
-- - The custom access-token hook in catalogsync_shop4_custom_access_token_hook
--   (or a new hook) must be extended to map each new identity UUID to its
--   corresponding reader role. See 20260717050000 for the existing pattern.
-- - The CatalogSync VPS workloads must be configured with each shop's
--   identity credentials and anon API key.

-- ============================================================================
-- 1. ROLES: one NOLOGIN NOBYPASSRLS reader per shop, with statement timeout
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catalogsync_shop1_reader') THEN
        CREATE ROLE catalogsync_shop1_reader
            NOLOGIN NOBYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catalogsync_shop2_reader') THEN
        CREATE ROLE catalogsync_shop2_reader
            NOLOGIN NOBYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'catalogsync_shop3_reader') THEN
        CREATE ROLE catalogsync_shop3_reader
            NOLOGIN NOBYPASSRLS;
    END IF;
END
$$;

ALTER ROLE catalogsync_shop1_reader NOLOGIN NOBYPASSRLS;
ALTER ROLE catalogsync_shop2_reader NOLOGIN NOBYPASSRLS;
ALTER ROLE catalogsync_shop3_reader NOLOGIN NOBYPASSRLS;

ALTER ROLE catalogsync_shop1_reader SET statement_timeout = '20s';
ALTER ROLE catalogsync_shop2_reader SET statement_timeout = '20s';
ALTER ROLE catalogsync_shop3_reader SET statement_timeout = '20s';

-- ============================================================================
-- 2. GRANT roles to authenticator (required by Supabase PostgREST)
-- ============================================================================

GRANT catalogsync_shop1_reader TO authenticator;
GRANT catalogsync_shop2_reader TO authenticator;
GRANT catalogsync_shop3_reader TO authenticator;

-- ============================================================================
-- 3. Schema USAGE (no CREATE — only read)
-- ============================================================================

GRANT USAGE ON SCHEMA public TO catalogsync_shop1_reader;
GRANT USAGE ON SCHEMA public TO catalogsync_shop2_reader;
GRANT USAGE ON SCHEMA public TO catalogsync_shop3_reader;

-- ============================================================================
-- 4. EXPLICIT REVOKES: no role-specific base-table, write, function, sequence,
--    or schema-create grants. PostgreSQL privileges inherited from PUBLIC are
--    outside a per-role REVOKE; this migration adds no function grant and the
--    runtime contract does not call RPC functions.
-- ============================================================================

REVOKE ALL ON ALL TABLES IN SCHEMA public
    FROM catalogsync_shop1_reader, catalogsync_shop2_reader, catalogsync_shop3_reader;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public
    FROM catalogsync_shop1_reader, catalogsync_shop2_reader, catalogsync_shop3_reader;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public
    FROM catalogsync_shop1_reader, catalogsync_shop2_reader, catalogsync_shop3_reader;
REVOKE CREATE ON SCHEMA public
    FROM catalogsync_shop1_reader, catalogsync_shop2_reader, catalogsync_shop3_reader;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES
    FROM catalogsync_shop1_reader, catalogsync_shop2_reader, catalogsync_shop3_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES
    FROM catalogsync_shop1_reader, catalogsync_shop2_reader, catalogsync_shop3_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS
    FROM catalogsync_shop1_reader, catalogsync_shop2_reader, catalogsync_shop3_reader;

-- ============================================================================
-- 5. SHARED LISTING-MAP VIEW with role-based shop isolation
--
--    PostgREST sets current_user to the JWT "role" claim after Auth
--    validation. The CASE expression maps each allowed reader role to its
--    shop_code; a role not in the CASE (e.g. anon, authenticated, or an
--    unknown reader) receives NULL and sees zero rows.
--
--    This is NOT RLS. RLS evaluates per-row policies on base tables against
--    the active role; here the filter lives in the view definition itself and
--    is evaluated by the PostgreSQL query planner on every access. Because
--    the roles are NOLOGIN and NOBYPASSRLS, no session can bypass the view
--    by connecting directly or running SET ROLE.
-- ============================================================================

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
    listing_sku.external_sku_id
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

-- ============================================================================
-- 6. SHARED CATALOG VIEW (column-limited, no shop filtering — same catalog
--    content for all shops 1-3)
-- ============================================================================

CREATE OR REPLACE VIEW public.catalogsync_mercari_catalog_v1
WITH (security_barrier = true)
AS
SELECT
    variant.id                              AS variant_id,
    variant.item_code,
    variant.status                          AS variant_status,
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

-- ============================================================================
-- 7. OWNERSHIP (set to postgres, not the reader roles)
-- ============================================================================

ALTER VIEW public.catalogsync_mercari_listing_map_v1 OWNER TO postgres;
ALTER VIEW public.catalogsync_mercari_catalog_v1 OWNER TO postgres;

-- ============================================================================
-- 8. REVOKE FROM PUBLIC / anon / authenticated
-- ============================================================================

REVOKE ALL ON public.catalogsync_mercari_listing_map_v1 FROM PUBLIC;
REVOKE ALL ON public.catalogsync_mercari_catalog_v1 FROM PUBLIC;
REVOKE ALL ON public.catalogsync_mercari_listing_map_v1 FROM anon, authenticated;
REVOKE ALL ON public.catalogsync_mercari_catalog_v1 FROM anon, authenticated;

-- ============================================================================
-- 9. GRANT SELECT to the three reader roles
-- ============================================================================

GRANT SELECT ON public.catalogsync_mercari_listing_map_v1
    TO catalogsync_shop1_reader,
       catalogsync_shop2_reader,
       catalogsync_shop3_reader;
GRANT SELECT ON public.catalogsync_mercari_catalog_v1
    TO catalogsync_shop1_reader,
       catalogsync_shop2_reader,
       catalogsync_shop3_reader;

-- ============================================================================
-- 10. COMMENTS — security model and recovery
-- ============================================================================

COMMENT ON VIEW public.catalogsync_mercari_listing_map_v1 IS
    'Shared Mercari listing-map view with current_user-based shop isolation. '
    'PostgREST sets current_user from the JWT role claim. The CASE/WHERE '
    'filter maps each reader role to its shop_code. Roles outside the CASE '
    'receive zero rows. NOLOGIN prevents direct login. Not RLS; '
    'view-level gate only. Existing shop4 views are unaffected.';

COMMENT ON VIEW public.catalogsync_mercari_catalog_v1 IS
    'Column-limited canonical catalog view shared by Mercari shops 1-3. '
    'No shop filtering — all roles see the same catalog content.';

COMMENT ON ROLE catalogsync_shop1_reader IS
    'NOLOGIN JWT role for read-only CatalogSync Mercari shop1 PostgREST access.';
COMMENT ON ROLE catalogsync_shop2_reader IS
    'NOLOGIN JWT role for read-only CatalogSync Mercari shop2 PostgREST access.';
COMMENT ON ROLE catalogsync_shop3_reader IS
    'NOLOGIN JWT role for read-only CatalogSync Mercari shop3 PostgREST access.';

NOTIFY pgrst, 'reload schema';
