-- Domain: product_catalog
-- Owner: retailpulses/RPagentOS
-- Affected: catalogsync_shop4_custom_access_token_hook
-- Change class: additive
-- Hosted write required: yes
-- Consumers: retailpulses/CatalogSync Mercari shops 1-3 VPS
-- Issue: https://github.com/retailpulses/CatalogSync/issues/34
-- Rollback: restore the prior hook body from 20260717050000 that recognizes
--   only the shop4 and marketplace identities.
--
-- Extend the owner-managed custom access-token hook to map the three shops 1-3
-- Supabase Auth workload identities to their corresponding reader roles.
-- Every unrecognized user retains its original claims. Existing shop4 and
-- marketplace identity mappings are preserved.

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
    WHEN 'f2214383-6188-42ea-8d42-7dd31b97dc69' THEN 'catalogsync_shop1_reader'
    WHEN '9f7ebd67-8b0f-4938-b395-b3f97b8fe7a1' THEN 'catalogsync_shop2_reader'
    WHEN '1fdd359b-239b-4531-a38b-bb779e56d116' THEN 'catalogsync_shop3_reader'
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
  'Assigns least-privilege reader roles only to the five dedicated CatalogSync Auth workload identities (shop4, marketplace, shop1, shop2, shop3).';

NOTIFY pgrst, 'reload schema';
