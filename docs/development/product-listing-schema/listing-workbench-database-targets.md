# Listing Workbench Database Targets

Date: 2026-07-06

## Rule

`.env.local` controls where local jobs run.

The Supabase SQL Editor applies to the selected cloud project only. Local Supabase and cloud Supabase are separate databases, even when they share the same migrations.

Before claiming MVP-0 verification, run:

```bash
npm run db:doctor
```

The doctor prints the configured `SUPABASE_URL`, whether it is local or cloud, the cloud project ref when applicable, Supabase CLI link state, and the required table/view checks.

## Setup Order

Apply and verify in this order:

1. Base product/listing schema
2. `listing_work_items` migration
3. Import product/listing data
4. Classify work items
5. Verify `/listing`

For this repo, the workbench migration is:

```text
supabase/migrations/20260706000200_listing_work_items.sql
```

## Cloud Migration Credentials

Do not treat browser SQL Editor success as proof that local jobs are using the same database.

For a safe CLI cloud migration deploy, all of these must be present and verified:

```text
SUPABASE_ACCESS_TOKEN
SUPABASE_PROJECT_REF
SUPABASE_DB_PASSWORD
```

The GitHub workflow `.github/workflows/supabase-migrations.yml` uses those secrets.
It is manual-only and defaults to dry-run. Run it with `dry_run=false` only when
you intend to apply pending migrations to the cloud project.

Local job verification must still use the `SUPABASE_URL` from `.env.local`.

## MVP-1 Local Qwen Bridge

The deployed `/listing` page is static Cloudflare Pages, but MVP-1 Qwen runs through local Ollama. To let the live page run Qwen safely, start the local bridge against the same database target the page is showing.

For local Supabase:

```bash
npm run qwen:bridge
```

For cloud Supabase, create a local-only `.env.cloud.local` with:

```text
SUPABASE_URL=https://gqeyfhshxdiyhugvmbuk.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<cloud secret/service key>
LISTING_QWEN_MODEL=qwen3.5:9b
```

Then run:

```bash
npm run qwen:bridge:cloud
```

The bridge listens on `http://127.0.0.1:8788`. The browser uses the anon key only; Qwen writes stay inside the local bridge process through the service-role key. Do not expose the bridge publicly.
