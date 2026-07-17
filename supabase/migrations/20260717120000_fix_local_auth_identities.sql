-- Domain: product_catalog
-- Owner: retailpulses/RPagentOS
-- Affected: catalogsync_shop4_custom_access_token_hook
-- Change class: additive (forward correction)
-- Hosted write required: yes
-- Consumers: retailpulses/CatalogSync Mercari shops 1-3 VPS
-- Issue: https://github.com/retailpulses/CatalogSync/issues/34
-- Forward-corrects: 20260717110000_catalogsync_shop1_3_auth_identity.sql
-- Rollback: restore the prior hook body from 20260717110000
--
-- The 20260717110000 migration deployed local-only Auth UUIDs for shops 1-3.
-- This forward correction replaces them with the actual hosted Supabase Auth
-- identity UUIDs. Shop4 and marketplace identity mappings are preserved.
-- Unknown events remain unchanged.
--
-- Invalid UUIDs removed:
--   f2214383-6188-42ea-8d42-7dd31b97dc69 (shop1)
--   9f7ebd67-8b0f-4938-b395-b3f97b8fe7a1 (shop2)
--   1fdd359b-239b-4531-a38b-bb779e56d116 (shop3)
--
-- Correct hosted UUIDs applied:
--   865a076c-cd9f-4fba-9fd2-4ff0a155f2c7 -> catalogsync_shop1_reader
--   a531e2ee-be44-4c7f-87da-7c1d0f75494f -> catalogsync_shop2_reader
--   31a4c8c5-f8dc-40a8-813c-e7939a4e16d3 -> catalogsync_shop3_reader

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
  'Assigns least-privilege reader roles to the five dedicated CatalogSync Auth workload identities. Forward-corrected 20260717120000: replaced local-only shop1-3 UUIDs with hosted identities.';

NOTIFY pgrst, 'reload schema';
