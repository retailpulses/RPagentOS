# Database Governance — Local Declaration

Repository: retailpulses/RPagentOS
Installed governance ref: v1.1.0
Last updated: 2026-07-17

## Repository Role

- **Supabase consumer:** yes
- **Migration owner:** yes

## Owned Domains

- `product_catalog` — products, product_variants, platform_listings, product_families, product_spus, product_assets, product_commercials, bundle_products, bundle_components, platform_listing_skus, platform_listing_images, platform_listing_attributes, platform_listing_price_tiers, product_platform_links, promotion_candidates, merchandising_focus_items, source_import_runs, source_import_rows, platform_accounts, import_errors, listing_target_classification_v1 view
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
  product-platform mapping records for Amazon and Rakuten.

The role has `USAGE` on `public` and `SELECT` on this view only. It has no base
table, function, sequence, schema-create, or write privileges. CatalogSync owns
the marketplace-specific HTTP API and its scope/completeness rules, but owns no
Supabase object and must not receive `service_role`.

The dedicated Supabase Auth workload identity
`053bd1a5-d9d1-4395-9ed5-3239dc9f62e4` is mapped to
`catalogsync_marketplace_reader` by the owner-managed custom access-token hook.
CatalogSync stores only that identity's credentials and the public anon API key;
it obtains short-lived JWTs at runtime. Unknown Auth identities retain their
original claims, and the existing shop4 identity mapping remains unchanged.

The complete access path is:

```text
Amazon/Rakuten VPS consumers
  -> CatalogSync marketplace projection API (`internal_api`)
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

## Deployment Authority

Hosted writes require explicit approval. See `docs/DATABASE_GOVERNANCE.md` in rp-governance-kit §6.

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
| 2026-07-17 | Extended custom access-token hook to map shops 1-3 identity UUIDs: `f2214383-6188-42ea-8d42-7dd31b97dc69` → `catalogsync_shop1_reader`, `9f7ebd67-8b0f-4938-b395-b3f97b8fe7a1` → `catalogsync_shop2_reader`, `1fdd359b-239b-4531-a38b-bb779e56d116` → `catalogsync_shop3_reader`. Resolves CatalogSync issue #34 owner-side follow-up. *Corrected by `20260717120000` — these UUIDs were local-only and never valid in hosted.* | RPagentOS | `20260717110000_catalogsync_shop1_3_auth_identity.sql` |
| 2026-07-17 | Forward correction: replaced local-only shops 1-3 Auth UUIDs with actual hosted identities. Preserved shop4 and marketplace mappings. Removed invalid `f2214383-6188-42ea-8d42-7dd31b97dc69`, `9f7ebd67-8b0f-4938-b395-b3f97b8fe7a1`, `1fdd359b-239b-4531-a38b-bb779e56d116`. Applied `865a076c-cd9f-4fba-9fd2-4ff0a155f2c7` → `catalogsync_shop1_reader`, `a531e2ee-be44-4c7f-87da-7c1d0f75494f` → `catalogsync_shop2_reader`, `31a4c8c5-f8dc-40a8-813c-e7939a4e16d3` → `catalogsync_shop3_reader`. | RPagentOS | `20260717120000_fix_local_auth_identities.sql` |
| 2026-07-17 | Added `scripts/backfill_mercari_listings_from_api.py` and `tests/test_backfill_mercari_listings_from_api.py`. Owner-side backfill for CatalogSync issue #34. Python stdlib, dry-run default, Mercari GraphQL pagination, PostgREST upsert into `platform_listings` + `platform_listing_skus`. Rollback/audit docs added to this section above. | RPagentOS | N/A (operational script) |
