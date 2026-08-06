-- Domain: inquiry_management (cross-domain retirement of RPagentOS legacy object)
-- Owner: retailpulses/RPagentOS for the object being retired
-- Affected: public.mercari_inquiries, public.mercari_inquiries_legacy
-- Change class: destructive rename with temporary read-only compatibility view
-- Hosted write required: yes (NOT authorized by this PR)
-- Related issue: retailpulses/inquiry-automation#35
-- Depends on: inquiry-automation migrations 20260721000000 and 20260721000001,
--             successful inquiry_historical_migration reconciliation
-- Compatibility-view removal target: 2026-10-31, and only after 30 consecutive
-- days with zero compatibility-view queries.
--
-- Safety contract:
--   * refuses to run before the canonical inquiries table exists;
--   * refuses to run while any legacy row lacks consolidation provenance;
--   * preserves the original table and data under an explicit legacy name;
--   * exposes a read-only worker-only compatibility view; and
--   * grants no browser role access and supports no legacy writes.
--
-- Rollback:
--   DROP VIEW public.mercari_inquiries;
--   ALTER TABLE public.mercari_inquiries_legacy RENAME TO mercari_inquiries;
--   Reapply the original privilege posture. Canonical consolidated rows remain.

DO $$
DECLARE
  unresolved_count BIGINT;
  current_kind "char";
BEGIN
  IF to_regclass('public.inquiries') IS NULL THEN
    RAISE EXCEPTION
      'Cannot retire mercari_inquiries before inquiry_management.inquiries exists';
  END IF;

  SELECT c.relkind
    INTO current_kind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'mercari_inquiries';

  IF current_kind IS NULL THEN
    RAISE EXCEPTION 'Legacy public.mercari_inquiries table is missing';
  END IF;

  -- A view means this forward migration has already completed.
  IF current_kind = 'v' THEN
    RETURN;
  END IF;

  IF current_kind <> 'r' THEN
    RAISE EXCEPTION 'Expected mercari_inquiries table, found relkind %', current_kind;
  END IF;

  SELECT count(*)
    INTO unresolved_count
    FROM public.mercari_inquiries legacy
    LEFT JOIN public.inquiries canonical
      ON canonical.legacy_mercari_inquiries_id = legacy.id
   WHERE canonical.id IS NULL;

  IF unresolved_count <> 0 THEN
    RAISE EXCEPTION
      'Refusing retirement: % legacy mercari_inquiries rows lack canonical provenance',
      unresolved_count;
  END IF;

  IF to_regclass('public.mercari_inquiries_legacy') IS NOT NULL THEN
    RAISE EXCEPTION 'Target table public.mercari_inquiries_legacy already exists';
  END IF;

  ALTER TABLE public.mercari_inquiries RENAME TO mercari_inquiries_legacy;
END;
$$;

REVOKE ALL ON TABLE public.mercari_inquiries_legacy
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.mercari_inquiries_legacy TO service_role;

COMMENT ON TABLE public.mercari_inquiries_legacy IS
  'Retired RPagentOS inquiry table. Immutable historical source; canonical data is public.inquiries.';

CREATE OR REPLACE VIEW public.mercari_inquiries
WITH (security_invoker = true, security_barrier = true)
AS
SELECT
  inquiry.id,
  inquiry.external_inquiry_id AS mercari_inquiry_id,
  inquiry.shop_key AS shop,
  inquiry.customer_nickname AS customer_name,
  primary_product.item_code_snapshot AS item_code,
  inquiry.status,
  inquiry.last_inbound_time AS last_message_at,
  inquiry.follow_up_sent_at,
  inquiry.notes,
  inquiry.created_at,
  inquiry.updated_at
FROM public.inquiries AS inquiry
LEFT JOIN LATERAL (
  SELECT link.item_code_snapshot
  FROM public.inquiry_product_links AS link
  WHERE link.inquiry_id = inquiry.id
  ORDER BY link.is_primary DESC, link.linked_at ASC
  LIMIT 1
) AS primary_product ON true
WHERE inquiry.deleted_at IS NULL;

REVOKE ALL ON TABLE public.mercari_inquiries
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.mercari_inquiries TO service_role;

COMMENT ON VIEW public.mercari_inquiries IS
  'Temporary read-only compatibility view over inquiry_management; remove no earlier than 2026-10-31 and only after 30 consecutive days with zero queries.';
