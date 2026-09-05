# Database Governance — Local Declaration

Repository: retailpulses/RPagentOS
Installed governance ref: v1.1.0
Last updated: 2026-07-17

## Repository Role

- **Supabase consumer:** yes
- **Migration owner:** yes

## Owned Domains

- `product_catalog` — products, product_variants, platform_listings, product_families, product_spus, product_assets, product_commercials, bundle_products, bundle_components, platform_listing_skus, platform_listing_images, platform_listing_attributes, platform_listing_price_tiers, product_platform_links, promotion_candidates, merchandising_focus_items, source_import_runs, source_import_rows, platform_accounts, platform_account_monthly_metrics, import_errors, listing_target_classification_v1 view
- `agent_os` — agent_runs, agent_decisions, human_approvals, agent_execution_logs
- `task_management` — tasks, task_targets, task_steps, task_comments, task_logs, task_select_options, task_attachments
- `project_management` — projects, project_attachments (shared with ticket-handling)
- `listing_intelligence` — listing_intelligence_runs, listing_intelligence_results, listing_work_items
- `listing_quality` — listing_qwen_reviews, listing_qwen_review_requests, listing_review_policies, listing_review_jobs, listing_quality_cycles, listing_review_schedule_status_v1 view

## Consumed Shared Domains

- `ticketing` (owned by ticket-handling) — tickets (for task linking)

## CatalogSync Mercari shop4 Read Boundary

RPagentOS owns the additive database objects that authorize the CatalogSync
shop4 MVP's direct, read-only PostgREST access:

- role `catalogsync_shop4_reader` — NOLOGIN, NOBYPASSRLS, 20-second statement
  timeout, granted to PostgREST `authenticator`
- view `catalogsync_mercari_shop4_listing_map_v1` — filters listing mappings to
  the active Mercari `shop4` account
- view `catalogsync_mercari_shop4_catalog_v1` — exposes only the catalog columns
  required for inventory, presale, shipping, and future pricing review

The role has no base-table privilege and no write privilege. CatalogSync owns no
schema object and must not receive `service_role`.

## CatalogSync Amazon/Rakuten Marketplace Projection Boundary

RPagentOS owns the additive database objects used by the CatalogSync-owned
marketplace projection API:

- role `catalogsync_marketplace_reader` — `NOLOGIN`, `NOBYPASSRLS`, ten-second
  statement timeout, selectable by PostgREST `authenticator` only;
- view `catalogsync_marketplace_projection_v1` — a security-barrier projection
  joining canonical variant, commercial, listing, listing-SKU, account, and
  product-platform mapping records for Amazon and Rakuten. It exposes the
  latest completed `catalog_sync_runs` heartbeat so consumers can enforce
  run-level freshness without reading the operational table directly.

The role has `USAGE` on `public` and `SELECT` on this view only. It has no base
table, function, sequence, schema-create, or write privileges. CatalogSync owns
the marketplace-specific HTTP API and its scope/completeness rules, but owns no
Supabase object and must not receive `service_role`.

Two dedicated Supabase Auth workload identities are mapped to
`catalogsync_marketplace_reader` by the owner-managed custom access-token hook:
the Worker identity `053bd1a5-d9d1-4395-9ed5-3239dc9f62e4` and the direct
Rakuten VPS identity `d889df06-2440-41de-8327-2a8b271e4966`. CatalogSync stores
only each identity's credentials and the public anon API key; it obtains
short-lived JWTs at runtime. Unknown Auth identities retain their original
claims, and the existing shop identities remain unchanged.

The complete access path is:

```text
Rakuten VPS consumer (direct) or Amazon VPS consumer (temporary Worker hop)
  -> PostgREST directly or CatalogSync marketplace projection API (`internal_api`)
  -> catalogsync_marketplace_projection_v1 (`postgrest`, read-only)
  -> RPagentOS-owned product_catalog tables
```

## CatalogSync Mercari Shops 1-3 Read Boundaries

RPagentOS owns the additive database objects that authorize the CatalogSync
Mercari shops 1-3 direct read-only PostgREST access:

- role `catalogsync_shop1_reader` — `NOLOGIN`, `NOBYPASSRLS`, 20-second
  statement timeout, selectable by PostgREST `authenticator` only
- role `catalogsync_shop2_reader` — same configuration
- role `catalogsync_shop3_reader` — same configuration
- view `catalogsync_mercari_listing_map_v1` — shared security-barrier
  listing-map view that uses `current_user` (set by PostgREST from the JWT
  `role` claim) to isolate each shop's rows. NOT RLS; a view-level role gate.
- view `catalogsync_mercari_catalog_v1` — column-limited canonical
  catalog projection shared by all three roles

Each role has `USAGE` on `public` and `SELECT` on the two shared views only.
Explicit `REVOKE` statements prevent role-specific base-table, write, function,
sequence, and schema-create grants as defense-in-depth. PostgreSQL privileges
inherited from `PUBLIC` remain governed centrally; this workload receives no
explicit function grant and does not call RPC functions.

The roles have no base-table privilege and no write privilege. CatalogSync owns
no schema object and must not receive `service_role`.

The existing shop4 views and `catalogsync_shop4_reader` role are preserved and
unaffected by these additions.

### Auth workload identity UUIDs

Each Mercari shop and the marketplace workload have dedicated Supabase Auth
identities mapped to their reader roles by the owner-managed custom access-token
hook. These are non-secret identity UUIDs (public identifiers in the Auth
identity provider, not credentials).

| UUID | Reader role | Created by |
|------|-------------|------------|
| `a2ef2824-de7a-456a-99c0-23f751635c00` | `catalogsync_shop4_reader` | `20260716123000` |
| `053bd1a5-d9d1-4395-9ed5-3239dc9f62e4` | `catalogsync_marketplace_reader` | `20260717050000` |
| `d889df06-2440-41de-8327-2a8b271e4966` | `catalogsync_marketplace_reader` | `20260720010000` |
| `865a076c-cd9f-4fba-9fd2-4ff0a155f2c7` | `catalogsync_shop1_reader` | `20260717120000` (corrected) |
| `a531e2ee-be44-4c7f-87da-7c1d0f75494f` | `catalogsync_shop2_reader` | `20260717120000` (corrected) |
| `31a4c8c5-f8dc-40a8-813c-e7939a4e16d3` | `catalogsync_shop3_reader` | `20260717120000` (corrected) |

The hook function `catalogsync_shop4_custom_access_token_hook` returns the event
unchanged for any `user_id` not in the CASE list, so unknown Auth identities
retain their original claims. CatalogSync stores only each identity's
credentials and the public anon API key; it obtains short-lived JWTs at runtime.

### Access path

```text
shop1/2/3 VPS consumers
  -> PostgREST (`postgrest`, read-only via JWT for shopX)
  -> catalogsync_mercari_listing_map_v1 or
     catalogsync_mercari_catalog_v1
  -> RPagentOS-owned product_catalog tables (indirectly, through views only)
```

## Owner-Side Backfill Tool: `scripts/backfill_mercari_listings_from_api.py`

### Purpose

Backfill `platform_listings` and `platform_listing_skus` rows for Mercari
shops 1-3 from the Mercari Shops GraphQL API.  Triggered when
`platform_accounts` has the shop records but the listing/SKU tables are empty
(for example, after a fresh CatalogSync issue #34 authentication setup).

### Rollback

If the backfill produces incorrect data:

1. Identify the affected rows via the JSON report's
   `candidate_external_listing_ids` values.
2. Delete **only** the rows that the tool created, using the report timestamps
   or the listing IDs:

   ```sql
   -- Find inserted rows (using report listing_ids)
   SELECT id, external_listing_id FROM platform_listings
   WHERE platform = 'mercari'
     AND shop_code = '<shop_code>'
     AND external_listing_id IN (<report listing IDs>);

   -- Delete SKUs first (CASCADE from listing deletion avoids this,
   -- but explicit order is safer for audit)
   DELETE FROM platform_listing_skus
   WHERE listing_id IN (
     SELECT id FROM platform_listings
     WHERE platform = 'mercari'
       AND shop_code = '<shop_code>'
       AND external_listing_id IN (<report listing IDs>)
   );

   DELETE FROM platform_listings
   WHERE platform = 'mercari'
     AND shop_code = '<shop_code>'
     AND external_listing_id IN (<report listing IDs>);
   ```

3. Verify zero rows remain for those external_listing_ids.
4. Do NOT use `TRUNCATE` unless the shop has zero legitimate rows.

### Audit

Run the dry-report (`--report path`) first.  The JSON report contains:

- `mercari_api.products_count` / `total_variants_count` — source truth
- `source_db.product_variants_with_item_code` — mapping coverage
- `candidates.listings` / `candidates.skus` — what would be written
- `unresolved_skus` — SKU codes with no matching `product_variants.item_code`
- `existing.listings_count` — pre-existing rows (dry-run only)

An audit-pass criterion: the report should show zero or an expected number of
`unresolved_skus`, and `candidates.listings` should match the known Mercari
product count for the shop.  Investigate any sudden increase in unresolved SKUs
before running `--apply`.

### Credential requirements

| Variable | Required for |
|---|---|
| `MERCARI_ACCESS_TOKEN` | Always |
| `SUPABASE_URL` | `--apply` and read-audit (account + variant map) |
| `SUPABASE_SERVICE_ROLE_KEY` | `--apply` and read-audit |

## Generated Types

**Exempt.** The Worker is the sole Supabase client. Types are generated from API route signatures.

## One-Off Workload: Mercari Monthly Account Metrics Seed

- **Workload ID:** `mercari_monthly_account_metrics_seed_20260824`
- **Category:** imports
- **Risk level:** medium
- **Trigger:** manual migration, one time
- **Affected table:** `platform_account_monthly_metrics`
- **Access path:** `direct_postgres` through the pinned Supabase CLI migration path
- **Expected volume:** 46 rows across Mercari shop1 through shop4
- **Concurrency:** 1
- **Retries:** 0
- **Kill switch:** cancel before migration transaction commit; SQL errors abort the transaction
- **Idempotency:** account/month/source unique key plus `ON CONFLICT DO NOTHING`
- **Rollback:** delete only rows matching the four exact source filenames and `mercari_seller_dashboard_monthly_csv`
- **Approval and evidence:** [RPagentOS issue #70](https://github.com/retailpulses/RPagentOS/issues/70)

## One-Off Workload: Shop4 Listing Price Import

- **Workload ID:** `shop4_listing_price_import_20260905`
- **Category:** imports
- **Risk level:** medium
- **Trigger:** manual migration, one time
- **Affected table:** `platform_listings`
- **Access path:** `direct_postgres` through the pinned Supabase CLI migration workflow
- **Expected volume:** 2,590 existing Mercari Shop4 product listings; excludes two fee/shipping adjustment-only records not modeled in `platform_listings`
- **Concurrency / retries:** one transaction / zero retries
- **Kill switch:** cancel before transaction commit; any validation error aborts all writes
- **Idempotency:** update only rows whose two price values differ; exact final readback is asserted
- **Scope:** `current_price` from CSV `現在価格`; `mercari_before_discount_price` from CSV `値引き前の価格`
- **Identity audit:** all 2,590 listing IDs must match; 2,579 current SKU matches plus 11 known historical SKU drifts are asserted separately because prices are listing-keyed
- **Rollback:** preserve imported prices; corrections require a new reviewed migration targeting exact listing IDs
- **Approval and evidence:** [RPagentOS issue #105](https://github.com/retailpulses/RPagentOS/issues/105)

## Manual Account Metrics Portal Entry Workload

- **Workload ID:** `account_metrics_manual_portal_entry`
- **Category:** agent_operations
- **Risk level:** medium while the temporary unauthenticated portal endpoint remains enabled
- **Trigger:** manual, user-triggered submission from `agent.homesbliss.net/metrics`
- **Affected tables:** `platform_accounts` (bounded active-account read) and `platform_account_monthly_metrics` (bounded conflict read plus insert)
- **Access path:** `internal_api` Cloudflare Pages Function using server-side PostgREST; the browser never receives a Supabase credential
- **Bounds:** at most 3 PostgREST requests and 1 inserted row per submission; no loop, pagination, retry, update, delete, or overwrite path
- **Concurrency:** one request-local execution; database uniqueness handles concurrent duplicate submissions
- **Idempotency:** reject any existing account/month before insert; the `platform_account_id, period_start, source_system` unique key rejects concurrent duplicate manual inserts
- **Kill switch:** remove or disable `onRequestPost` in `functions/api/account-metrics.ts` and redeploy the Pages application
- **Rollback:** disable POST; preserve submitted rows for audit. Any later correction/removal requires a separately reviewed owner operation targeting explicit row IDs.
- **Authentication exception:** temporary unauthenticated POST explicitly requested by the owner; retirement and portal-wide authorization are tracked in [RPagentOS issue #85](https://github.com/retailpulses/RPagentOS/issues/85)
- **Approval and implementation:** [RPagentOS issue #86](https://github.com/retailpulses/RPagentOS/issues/86)
- **Canonical registration:** [rp-governance-kit issue #51](https://github.com/retailpulses/rp-governance-kit/issues/51)

## Deployment Authority

Hosted writes require explicit approval. See `docs/DATABASE_GOVERNANCE.md` in rp-governance-kit §6.

## Rakuten DeepSeek Copy Improvement Workload

- **Workload ID:** `rakuten_deepseek_copy_live_loop`
- **Category:** scheduled_jobs
- **Risk level:** medium
- **Trigger:** `17 */2 * * *` UTC and bounded manual dispatch
- **Access path:** PostgREST reads/audit rows plus revision-checked `internal_api` canonical writes
- **Bounds:** one listing per scheduled invocation, five maximum for manual runs, concurrency one
- **Selection:** deterministic opportunity score; `giga_generated` Rakuten drafts/enhanced only; hero, recently reviewed, and strong-copy listings excluded; evidence-poor or unsupported low-quality listings are tagged without an LLM call
- **Disposition:** `auto_fixable`, `auto_updated`, or `needs_operator_review`; the latter includes durable reason codes and does not block later scheduled work
- **Auto gate:** DeepSeek evidence audit passes, no specification conflict, original content preserved, an auto-fixable weakness (including `low_commercial_coverage`) exists, commercial delta >= 10, confidence >= 0.90, shop allowlisted
- **Repair:** one evidence-constrained model retry using exact deterministic validation feedback; a second failure becomes `needs_operator_review`
- **Operator approval:** optional; exceptions are skipped and audited, never held as a default gate
- **Timeout/retry:** each PostgREST request has a 30-second abort timeout; model repair is bounded to one attempt; workflow timeout remains 15 minutes
- **Request budget:** concurrency one; at most 50 database/internal API and LLM requests per invocation; catalog data is fetched in bounded bulk queries before the per-listing model loop
- **Kill switch:** set `COPY_IMPROVEMENT_ENABLED` to any value other than exact `true`, disable `.github/workflows/rakuten-copy-canary.yml`, or clear the shop allowlist
- **Credential class:** server-side service role for bounded reads/audit plus dedicated internal API bearer token for revision-checked writes
- **Rollback:** disable the workflow; restore an affected listing through the existing revisioned catalog lifecycle path using its prior audit snapshot
- **Reporting:** every scheduled or manual job sends a bounded summary and listing title/description diff to the configured WeCom webhook; the URL is stored only as a GitHub Secret
- **Approval:** Retailpulses owner requested a live DeepSeek loop on 2026-08-14
- **Issue:** `retailpulses/RPagentOS#64`
- **Registry:** `retailpulses/rp-governance-kit` `docs/DATABASE_WORKLOADS.yaml#rakuten_deepseek_copy_live_loop`

## Database Environment Model

**Shared.** Multiple repositories connect to one hosted Supabase project. Production and staging are not yet separated (documented technical debt).

## Supabase CLI Version

- Local (Homebrew): `2.109.1`
- CI migration deploy: `2.109.1`

## Known Technical Debt

- Duplicate migrations `20260708000002` and `20260708000003` exist in both this repo and ticket-handling (near-identical). This repo is the canonical owner.
- `20260707000000_remote_history_baseline.sql` is a history alignment artifact
- No-RLS MVP pattern for listing_work_items (anon key writes) — documented debt

## Changelog

| Date | Change | Author | Migration |
|------|--------|--------|-----------|
| 2026-07-20 | Added the latest completed catalog run ID, status, total SKU count, and finish time to the SELECT-only marketplace projection. This is the authoritative freshness signal because unchanged SKUs intentionally retain older per-row timestamps. | RPagentOS | `20260720020000_catalogsync_projection_run_freshness.sql` |
| 2026-07-20 | Added the dedicated CatalogSync Rakuten VPS Auth identity and mapped it to the existing SELECT-only marketplace projection reader role. | RPagentOS | `20260720010000_catalogsync_rakuten_vps_auth_identity.sql` |
| 2026-07-17 | Extended custom access-token hook to map shops 1-3 identity UUIDs: `f2214383-6188-42ea-8d42-7dd31b97dc69` → `catalogsync_shop1_reader`, `9f7ebd67-8b0f-4938-b395-b3f97b8fe7a1` → `catalogsync_shop2_reader`, `1fdd359b-239b-4531-a38b-bb779e56d116` → `catalogsync_shop3_reader`. Resolves CatalogSync issue #34 owner-side follow-up. *Corrected by `20260717120000` — these UUIDs were local-only and never valid in hosted.* | RPagentOS | `20260717110000_catalogsync_shop1_3_auth_identity.sql` |
| 2026-07-17 | Forward correction: replaced local-only shops 1-3 Auth UUIDs with actual hosted identities. Preserved shop4 and marketplace mappings. Removed invalid `f2214383-6188-42ea-8d42-7dd31b97dc69`, `9f7ebd67-8b0f-4938-b395-b3f97b8fe7a1`, `1fdd359b-239b-4531-a38b-bb779e56d116`. Applied `865a076c-cd9f-4fba-9fd2-4ff0a155f2c7` → `catalogsync_shop1_reader`, `a531e2ee-be44-4c7f-87da-7c1d0f75494f` → `catalogsync_shop2_reader`, `31a4c8c5-f8dc-40a8-813c-e7939a4e16d3` → `catalogsync_shop3_reader`. | RPagentOS | `20260717120000_fix_local_auth_identities.sql` |
| 2026-07-17 | Added `scripts/backfill_mercari_listings_from_api.py` and `tests/test_backfill_mercari_listings_from_api.py`. Owner-side backfill for CatalogSync issue #34. Python stdlib, dry-run default, Mercari GraphQL pagination, PostgREST upsert into `platform_listings` + `platform_listing_skus`. Rollback/audit docs added to this section above. | RPagentOS | N/A (operational script) |
