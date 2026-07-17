-- Domain: product_catalog
-- Owner: retailpulses/RPagentOS
-- Affected: catalogsync_shop4_custom_access_token_hook
-- Change class: additive
-- Hosted write required: yes
-- Consumers: retailpulses/CatalogSync
-- Issue: https://github.com/retailpulses/RPagentOS/issues/32
-- Rollback: restore the prior hook body that recognizes only the shop4 identity.

-- Keep one owner-managed Supabase Auth hook for both dedicated CatalogSync
-- workload identities. Every unrecognized user retains its original claims.
CREATE OR REPLACE FUNCTION public.catalogsync_shop4_custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  claims jsonb;
  workload_role text;
BEGIN
  workload_role := CASE event->>'user_id'
    WHEN 'a2ef2824-de7a-456a-99c0-23f751635c00' THEN 'catalogsync_shop4_reader'
    WHEN '053bd1a5-d9d1-4395-9ed5-3239dc9f62e4' THEN 'catalogsync_marketplace_reader'
    ELSE NULL
  END;

  IF workload_role IS NULL THEN
    RETURN event;
  END IF;

  claims := COALESCE(event->'claims', '{}'::jsonb);
  claims := jsonb_set(claims, '{role}', to_jsonb(workload_role), true);
  RETURN jsonb_set(event, '{claims}', claims, true);
END;
$$;

REVOKE ALL ON FUNCTION public.catalogsync_shop4_custom_access_token_hook(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.catalogsync_shop4_custom_access_token_hook(jsonb)
  TO supabase_auth_admin;

COMMENT ON FUNCTION public.catalogsync_shop4_custom_access_token_hook(jsonb) IS
  'Assigns least-privilege reader roles only to the two dedicated CatalogSync Auth workload identities.';
