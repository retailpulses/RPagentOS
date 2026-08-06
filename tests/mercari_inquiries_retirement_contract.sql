DO $$
DECLARE
  legacy_kind "char";
  compat_kind "char";
  missing_count BIGINT;
BEGIN
  SELECT c.relkind INTO legacy_kind
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'mercari_inquiries_legacy';
  IF legacy_kind <> 'r' THEN
    RAISE EXCEPTION 'mercari_inquiries_legacy must be a table, found %', legacy_kind;
  END IF;

  SELECT c.relkind INTO compat_kind
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'mercari_inquiries';
  IF compat_kind <> 'v' THEN
    RAISE EXCEPTION 'mercari_inquiries must be a view, found %', compat_kind;
  END IF;

  SELECT count(*) INTO missing_count
  FROM public.mercari_inquiries_legacy legacy
  LEFT JOIN public.inquiries canonical
    ON canonical.legacy_mercari_inquiries_id = legacy.id
  WHERE canonical.id IS NULL;
  IF missing_count <> 0 THEN
    RAISE EXCEPTION '% legacy rows are not consolidated', missing_count;
  END IF;

  IF has_table_privilege('anon', 'public.mercari_inquiries', 'SELECT')
     OR has_table_privilege('authenticated', 'public.mercari_inquiries', 'SELECT') THEN
    RAISE EXCEPTION 'browser roles must not read compatibility view';
  END IF;
END;
$$;
