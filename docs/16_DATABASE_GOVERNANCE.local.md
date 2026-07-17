# Database Governance — Local Declaration

Repository: retailpulses/RPagentOS
Installed governance ref: v1.1.0
Last updated: 2026-07-15

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

### Follow-up: Auth workload identities

Supabase Auth workload identities (one UUID per shop) must be created in the
Auth dashboard or via the Auth Admin API. The custom access-token hook
(`catalogsync_shop4_custom_access_token_hook`) must then be extended to map
each new identity UUID to its reader role. This migration does not create
identities or invent UUIDs — that is a separate, required follow-up step.

### Access path

```text
shop1/2/3 VPS consumers
  -> PostgREST (`postgrest`, read-only via JWT for shopX)
  -> catalogsync_mercari_listing_map_v1 or
     catalogsync_mercari_catalog_v1
  -> RPagentOS-owned product_catalog tables (indirectly, through views only)
```

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
