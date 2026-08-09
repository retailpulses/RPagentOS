-- Domain: product_catalog, agent_os, listing_intelligence, listing_quality
-- Owner: retailpulses/RPagentOS
-- Affected: supabase_migrations.schema_migrations (tracking table only)
-- Change class: administrative (no schema or data changes)
-- Hosted write required: yes (INSERT into schema_migrations)
-- Consumers: RPagentOS (migration tracking consistency)
--
-- Purpose:
--   Migrations 20260718000000 through 20260718000004 were applied to the
--   hosted database via direct psycopg2 on 2026-07-15 (emergency deployment
--   before the Supabase CLI migration workflow was established).  The
--   objects exist on the hosted database, but supabase_migrations.schema_migrations
--   has no record of them — so `supabase db push` attempts to re-run them
--   and fails (e.g. "CREATE TRIGGER already exists").
--
--   This migration inserts the missing tracking records so the Supabase
--   migration system recognizes them as applied.  It is idempotent
--   (ON CONFLICT DO NOTHING).
--
--   References:
--     rp-governance-kit#32 — emergency-change reconciliation
--     20260718000000_add_mercari_pricing_trigger.sql
--     20260718000001_create_resource_packs_and_copy_tables.sql
--     20260718000002_create_mercari_batch_update_log.sql
--     20260718000003_create_mercari_inquiries.sql
--     20260718000004_create_amazon_listings.sql
--
-- Rollback:
--   DELETE FROM supabase_migrations.schema_migrations
--   WHERE version IN ('20260718000000','20260718000001','20260718000002',
--                     '20260718000003','20260718000004');
--   (Only removes the tracking records — does not drop any database objects.)

INSERT INTO supabase_migrations.schema_migrations (version) VALUES
    ('20260718000000'),
    ('20260718000001'),
    ('20260718000002'),
    ('20260718000003'),
    ('20260718000004')
ON CONFLICT (version) DO NOTHING;
