-- Domain: product_catalog
-- Owner: retailpulses/RPagentOS
-- Change class: additive
-- Hosted write required: yes
-- Consumer: retailpulses/CatalogSync Mercari shop4 VPS
--
-- Bind exactly one dedicated Supabase Auth workload identity to the existing
-- NOLOGIN, read-only catalogsync_shop4_reader PostgREST role. All other Auth
-- identities retain their original claims.

CREATE OR REPLACE FUNCTION public.catalogsync_shop4_custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  claims jsonb;
BEGIN
  IF event->>'user_id' <> 'a2ef2824-de7a-456a-99c0-23f751635c00' THEN
    RETURN event;
  END IF;

  claims := COALESCE(event->'claims', '{}'::jsonb);
  claims := jsonb_set(
    claims,
    '{role}',
    to_jsonb('catalogsync_shop4_reader'::text),
    true
  );
  RETURN jsonb_set(event, '{claims}', claims, true);
END;
$$;

REVOKE ALL ON FUNCTION public.catalogsync_shop4_custom_access_token_hook(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.catalogsync_shop4_custom_access_token_hook(jsonb)
  TO supabase_auth_admin;

COMMENT ON FUNCTION public.catalogsync_shop4_custom_access_token_hook(jsonb) IS
  'Assigns catalogsync_shop4_reader only to the dedicated CatalogSync shop4 Auth identity.';
