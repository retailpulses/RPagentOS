-- Domain: product_catalog
-- Owner: retailpulses/RPagentOS
-- Affected: catalogsync_shop4_custom_access_token_hook
-- Change class: additive
-- Hosted write required: yes
-- Consumers: retailpulses/CatalogSync Rakuten VPS
-- Issue: https://github.com/retailpulses/CatalogSync/issues/61
-- Rollback: restore the prior hook body from 20260717120000.

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
    WHEN 'd889df06-2440-41de-8327-2a8b271e4966' THEN 'catalogsync_marketplace_reader'
    WHEN '865a076c-cd9f-4fba-9fd2-4ff0a155f2c7' THEN 'catalogsync_shop1_reader'
    WHEN 'a531e2ee-be44-4c7f-87da-7c1d0f75494f' THEN 'catalogsync_shop2_reader'
    WHEN '31a4c8c5-f8dc-40a8-813c-e7939a4e16d3' THEN 'catalogsync_shop3_reader'
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
  'Assigns least-privilege reader roles to six dedicated CatalogSync Auth workload identities, including the direct Rakuten VPS reader.';

NOTIFY pgrst, 'reload schema';
