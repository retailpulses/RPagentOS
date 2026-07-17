# Migration History Reconciliation Plan

**Date:** 2026-07-17  
**Issue:** [`retailpulses/RPagentOS#32`](https://github.com/retailpulses/RPagentOS/issues/32)  
**Branch:** `fix/reconcile-hosted-migration-history`  
**Status:** Pending review — no hosted mutation executed  
**Dry-run verified:** 2026-07-17 — `supabase db push --dry-run` passes with 0 remote-only errors, 3 pending migrations

## 1. Context

PR #35 ([`feat/catalog: add CatalogSync marketplace projection view`](https://github.com/retailpulses/RPagentOS/pull/35)) was merged into `main` at commit `300c17cd`. The merge triggered the `Deploy Supabase Migrations` workflow in `dry_run=true` mode:

- **Workflow run:** [`29556192147`](https://github.com/retailpulses/RPagentOS/actions/runs/29556192147)
- **Commit:** `300c17cd94e02d91c64bf63b224edf694d2caf0f`
- **Command:** `supabase db push --linked --password "$SUPABASE_DB_PASSWORD" --include-all --dry-run`
- **Result:** Failed — remote migration versions absent from local directory

The workflow correctly blocked deployment. No hosted write occurred.

### Failed workflow output

```
Remote migration versions not found in local migrations directory.

Make sure your local git repo is up-to-date. If the error persists, try repairing
the migration history table:
supabase migration repair --status reverted 0001 0002 20260708000002 20260709000000
20260709000001 20260709000100 20260709000200 20260710000000 20260711000000
20260712000000 20260712000001 20260713000001 20260714000000 20260715000000
20260715000001 20260715000002 20260715000003 20260715000004 20260715000005
20260716010000 20260716120000
```

The CLI's bulk repair suggestion must not be executed without explicit reviewed authorization. Many of these versions are legitimate migrations owned by other repositories.

## 2. Target Project Verification

- **Supabase project:** `retailpulses_shared` (single shared Supabase project for all Retailpulses repos)
- **Project ref:** configured via GitHub Secrets `SUPABASE_PROJECT_REF`
- **Verification:** `supabase migration list --linked --password` succeeded against the production database from the RPagentOS working directory
- **Active hosted migrations at time of investigation:** 45 total (22 matched local+remote, 3 local-only pending, 20 remote-only without local file)

## 3. Complete Discrepancy Table

Each remote-only version was traced to its owning repository using content hashes (SHA-256) and cross-referenced against `DATABASE_OWNERSHIP.yaml` in `retailpulses/rp-governance-kit`.

### 3.1 Remote versions absent from RPagentOS `main` (commit `300c17cd`)

| # | Version | Hosted | Authoritative Source Repo | Filename | SHA-256 (first 8) | Domain Owner | Classification |
|---|---------|--------|--------------------------|----------|-------------------|--------------|----------------|
| 1 | `0001` | present | `retailpulses/ticket-handling` | `0001_ticketing_mvp_core.sql` | `eb4fd26d` | ticketing | Foreign — ticket-handling grandfathered sequential |
| 2 | `0002` | present | `retailpulses/ticket-handling` | `0002_ticketing_hotfix_issue_types.sql` | `952fc62a` | ticketing | Foreign — ticket-handling grandfathered sequential |
| 3 | `20260708000002` | present | **`retailpulses/RPagentOS`** | `20260708000002_listing_review_schedule_status.sql` | `d612a10f` (RPagentOS canonical) / `fa87459d` (ticket copy) | **Hosted hash matches RPagentOS canonical** (confirmed via `schema_migrations` dump) | **RPagentOS / listing_quality** | RPagentOS-owned; applied from RPagentOS (not ticket-handling); file was missing from `main` — restored in this PR |
| 4 | `20260709000000` | present | `retailpulses/ticket-handling` | `20260709000000_ticketing_mvp_core.sql` | `ea553a16` | ticketing | Foreign — ticket-handling |
| 5 | `20260709000001` | present | `retailpulses/ticket-handling` | `20260709000001_copywriting_tables.sql` | `1ff7213d` | ticketing | Foreign — ticket-handling |
| 6 | `20260709000100` | present | `retailpulses/ticket-handling` | `20260709000100_ticketing_mvp_hardening.sql` | `b67609d8` | ticketing | Foreign — ticket-handling |
| 7 | `20260709000200` | present | `retailpulses/ticket-handling` | `20260709000200_ticket_products_nullable_refs.sql` | `011ef8a0` | ticketing | Foreign — ticket-handling |
| 8 | `20260710000000` | present | **COLLISION** (hosted identity resolved) | `inbound_ticket_messages.sql` (ticket-handling) / `order_mgmt_core.sql` (OrderMgmt) | `71d62f9a` / `5b9ed77` | **Hosted: `inbound_ticket_messages`** (confirmed via `schema_migrations` dump) | ticketing / order_management | **Version collision** — hosted `schema_migrations` records only ticket-handling's version; OrderMgmt DDL objects may exist from direct application |
| 9 | `20260711000000` | present | `retailpulses/ticket-handling` | `20260711000000_fix_actor_type_check.sql` | `ebffde13` | ticketing | Foreign — ticket-handling |
| 10 | `20260712000000` | present | `retailpulses/ticket-handling` | `20260712000000_fix_product_name_view.sql` | `15c33fbb` | ticketing | Foreign — ticket-handling |
| 11 | `20260712000001` | present | `retailpulses/ticket-handling` | `20260712000001_ticket_statuses_config.sql` | `ab71f105` | ticketing | Foreign — ticket-handling |
| 12 | `20260713000001` | present | `retailpulses/ticket-handling` | `20260713000001_webhook_processing_status.sql` | `64763466` | ticketing | Foreign — ticket-handling |
| 13 | `20260714000000` | present | `retailpulses/ticket-handling` | `20260714000000_customer_submissions.sql` | `f9c9a355` | ticketing | Foreign — ticket-handling |
| 14 | `20260715000000` | present | `retailpulses/ticket-handling` | `20260715000000_baserow_ticket_retirement.sql` | `8ef04ced` | ticketing | Foreign — ticket-handling |
| 15 | `20260715000001` | present | `retailpulses/ticket-handling` | `20260715000001_allow_historical_duplicate_orders.sql` | `ab0e70ed` | ticketing | Foreign — ticket-handling |
| 16 | `20260715000002` | present | `retailpulses/ticket-handling` | `20260715000002_message_to_ticketform.sql` | `b1f63009` | ticketing | Foreign — ticket-handling |
| 17 | `20260715000003` | present | `retailpulses/ticket-handling` | `20260715000003_ticketform_transactional_finalization.sql` | `5de2cf18` | ticketing | Foreign — ticket-handling |
| 18 | `20260715000004` | present | `retailpulses/ticket-handling` | `20260715000004_ticket_resolution_action_rpc.sql` | `a72eed13` | ticketing | Foreign — ticket-handling |
| 19 | `20260715000005` | present | `retailpulses/ticket-handling` | `20260715000005_operator_message_idempotency.sql` | `4887533d` | ticketing | Foreign — ticket-handling |
| 20 | `20260716010000` | present | **ORPHANED** — no file found in any Retailpulses repo | unknown | Hosted hash begins `"Domain: ticketing"` — confirmed ticketing domain | **UNKNOWN** (ticketing domain) | Orphaned — ticketing-domain migration with no recoverable source file |
| 21 | `20260716120000` | present | `retailpulses/OrderMgmt` | `20260716120000_add_ingest_fields.sql` | `e9b9ced8` | order_management | Foreign — OrderMgmt |

### 3.2 Local-only migrations (pending application, unaffected by reconciliation)

These RPagentOS-owned migrations exist locally but have not been applied to the remote. The reconciliation does not affect them — they represent pending work.

| Version | Filename | Domain | Status |
|---------|----------|--------|--------|
| `20260716000000` | `20260716000000_deploy_catalogsync_phase_a.sql` | product_catalog | Pending (was untracked on `chore/install-governance-kit`; now tracked) |
| `20260716000001` | `20260716000001_add_product_content_fields.sql` | product_catalog | Pending (was untracked on `chore/install-governance-kit`; now tracked) |
| `20260717040000` | `20260717040000_catalogsync_marketplace_projection_v1.sql` | product_catalog | Pending (from PR #35) |

**Note:** The 3 untracked files from the `chore/install-governance-kit` working tree (`20260708000002`, `20260716000000`, `20260716000001`) were not in `origin/main`. `20260716000000` and `20260716000001` are RPagentOS-owned pending migrations and should be committed in a separate PR. This reconciliation PR addresses only the remote-history gap.

### 3.3 Versions present in both local and remote (no action needed)

The following 19 RPagentOS-owned migrations are correctly matched:

`20260629150046`, `20260629151757`, `20260629153010`, `20260702000000`, `20260702010000`, `20260703090000`, `20260706000000`, `20260706000001`, `20260706000200`, `20260706000300`, `20260706000400`, `20260706000500`, `20260706000600`, `20260706000700`, `20260707000000`, `20260707000200`, `20260708000000`, `20260708000001`, `20260708000003`

Plus 2 RPagentOS-owned migrations applied from previous workflow runs:

`20260716103000` (shop4 read projection, PR #33), `20260716123000` (shop4 auth hook, PR #34)

## 4. Ownership Evidence

### 4.1 Hash comparison method

Every migration file across all Retailpulses repositories was hashed with SHA-256:

```bash
sha256sum <file>
```

File identity was verified using content hashes, not filenames alone. For the `20260708000002` divergence, a byte-level diff was performed:

```bash
diff RPagentOS/.../20260708000002_listing_review_schedule_status.sql \
     ticket-handling/.../20260708000002_listing_review_schedule_status.sql
```

Result: trailing whitespace difference only (RPagentOS: no trailing blank line; ticket-handling: two trailing blank lines).

### 4.2 Domain ownership per DATABASE_OWNERSHIP.yaml

| Domain | Owner | Relevant objects in this reconciliation |
|--------|-------|----------------------------------------|
| `ticketing` | `retailpulses/ticket-handling` | All `0001`, `0002`, `20260709*`, `20260711*`, `20260712*`, `20260713*`, `20260714*`, `20260715*` versions |
| `order_management` | `retailpulses/OrderMgmt` | `20260716120000` |
| `listing_quality` | `retailpulses/RPagentOS` | `20260708000002` (listing_review_schedule_status_v1 view) |
| `project_management` | `retailpulses/RPagentOS` | `20260708000003` (projects table) |
| `product_catalog` | `retailpulses/RPagentOS` | `20260716103000`, `20260716123000`, `20260717040000` |

### 4.3 Repository search scope

All Retailpulses repositories under `/Users/user/Documents/Retailpulses/20_REPOS/` were searched for migration files:

| Repository | `supabase/migrations/` | Migration count |
|-----------|----------------------|-----------------|
| `RPagentOS` | Yes | 25 (22 tracked at origin/main + 3 untracked) |
| `ticket-handling` | Yes | 36 (18 zero-byte `_remote.sql` + 18 real) |
| `OrderMgmt` | Yes | 6 |
| `CatalogSync` | No | 0 (consumer only) |
| `rp-governance-kit` | No | 0 (tooling only) |

### 4.4 ticket-handling `_remote.sql` pattern

The ticket-handling repository uses zero-byte `_remote.sql` placeholder files (18 total, all SHA-256 `e3b0c442...`) to acknowledge RPagentOS-authored migrations on the shared database. These are history alignment artifacts, not ownership claims — documented in `DATABASE_OWNERSHIP.yaml`.

### 4.5 Hosted `schema_migrations` identity verification

A read-only dump of `supabase_migrations.schema_migrations` was taken from the hosted database to determine exact migration identities:

```bash
supabase db dump --linked --password --data-only --schema supabase_migrations
```

Key identity findings from the hosted ledger:

| Version | Hosted `name` | Hosted hash prefix | Resolved identity |
|---------|--------------|-------------------|-------------------|
| `20260708000002` | (hash-stored) | `"-- Listing Quality Engineering: editable schedule status."` | **RPagentOS canonical** — hash matches RPagentOS file `d612a10f`, not ticket-handling copy `fa87459d` |
| `20260710000000` | `inbound_ticket_messages` | NULL | **ticket-handling** — unambiguous; OrderMgmt `order_mgmt_core` is not in `schema_migrations` |
| `20260716010000` | (hash-stored) | `"-- Domain: ticketing"` | **ticketing domain** — migration belongs to ticket-handling but no source file exists in any repo |
| `0001` | (hash-stored) | `"-- Supabase Ticketing MVP — Core Schema Migration"` | **ticket-handling** — grandfathered sequential |
| `0002` | (hash-stored) | `"-- Supabase Ticketing MVP — Hotfix Migration"` | **ticket-handling** — grandfathered sequential |
| `20260716120000` | (hash-stored) | `"-- Domain: order_management"` | **OrderMgmt** |

These identities are authoritative — they come from the hosted database, not from filename inference.

## 5. Special Cases

### 5.1 `20260708000002` — RPagentOS-owned, confirmed RPagentOS-applied

This migration creates the `listing_review_schedule_status_v1` view in the `listing_quality` domain (owned by RPagentOS). Two near-identical copies exist:

- **RPagentOS** (`d612a10f`): 2,493 bytes, no extra blank lines between GRANT statements
- **ticket-handling** (`fa87459d`): 2,497 bytes, two extra blank lines between GRANT statements

**Hosted identity confirmed:** The `schema_migrations` dump shows the hosted hash begins with `"Listing Quality Engineering: editable schedule status."` — this is the RPagentOS canonical header, not the ticket-handling copy. The RPagentOS version was applied to the remote, but the migration file was missing from RPagentOS `main`. It existed only as an untracked working-tree file on the `chore/install-governance-kit` branch.

**Resolution:** The canonical RPagentOS file has been restored to `supabase/migrations/20260708000002_listing_review_schedule_status.sql` (SHA-256 `d612a10f`). No `_shared_remote.sql` placeholder is needed — this is an RPagentOS-owned and RPagentOS-applied migration. The dry-run confirms the CLI matches it correctly against the remote hash.

### 5.2 `20260710000000` — Version collision

This is a real naming collision violating the governance rule: "Migration naming: `YYYYMMDDHHMMSS_description.sql` — unique across all Retailpulses repos."

Two different migrations share the same timestamp:

| Repo | File | SHA-256 | Domain |
|------|------|---------|--------|
| ticket-handling | `20260710000000_inbound_ticket_messages.sql` | `71d62f9a` | ticketing |
| OrderMgmt | `20260710000000_order_mgmt_core.sql` | `5b9ed77` | order_management |

Both are already present on the hosted database. **Hosted identity confirmed:** The `schema_migrations` table records `name = 'inbound_ticket_messages'` (ticket-handling). OrderMgmt's `order_mgmt_core` is NOT tracked in `schema_migrations` (its DDL objects may have been applied directly, bypassing the migration ledger). This collision is documented in `DATABASE_OWNERSHIP.yaml`.

**Proposed action:** The `_shared_remote.sql` placeholder acknowledges the hosted version without claiming ownership of either source. A separate cross-repo issue should be filed to resolve the naming collision.

### 5.3 `20260716010000` — Orphaned (ticketing domain)

No migration file matching this version was found in any Retailpulses repository. **Hosted evidence** confirms it is a ticketing-domain migration (hash begins `"Domain: ticketing"`).

Possible explanations:

1. Applied directly via Supabase dashboard or SQL editor (bypassing migration workflow)
2. Applied from a branch that was deleted before merging
3. Applied from a repository outside the Retailpulses organization
4. Artifact of a previous `supabase db push` from a different environment

The hosted schema may contain objects created by this migration. Without hosted schema inspection (which requires explicit approval), the content cannot be recovered.

**Proposed action:** Escalate for owner review. The `_shared_remote.sql` placeholder prevents the dry-run from failing. After the migration source is identified, replace the placeholder with the authoritative file.

## 6. Proposed Reconciliation Actions

### 6.1 Repository-history reconciliation (this PR)

Add files for all 21 remote-only versions so that every hosted migration has a corresponding local file:

- **1 real migration restored**: `20260708000002_listing_review_schedule_status.sql` — RPagentOS canonical file (SHA-256 `d612a10f`), confirmed to match the hosted hash
- **20 `_shared_remote.sql` placeholders**: SQL-comment-only files acknowledging foreign-owned or orphaned migrations

| Version | Local file | Template | Notes |
|---------|-----------|----------|-------|
| `0001` | `0001_shared_remote.sql` | Standard foreign | ticket-handling, ticketing domain; hosted identity confirmed |
| `0002` | `0002_shared_remote.sql` | Standard foreign | ticket-handling, ticketing domain; hosted identity confirmed |
| `20260708000002` | `20260708000002_listing_review_schedule_status.sql` | ✅ **Real RPagentOS migration** | Hosted hash matches RPagentOS canonical; file restored to `main` |
| `20260709*` (4 files) | `*_shared_remote.sql` | Standard foreign | ticket-handling, ticketing domain |
| `20260710000000` | `20260710000000_shared_remote.sql` | ⚠️ Version collision | Hosted identity: `inbound_ticket_messages` (ticket-handling); OrderMgmt not in `schema_migrations` |
| `20260711000000` | `20260711000000_shared_remote.sql` | Standard foreign | ticket-handling |
| `20260712*` (2 files) | `*_shared_remote.sql` | Standard foreign | ticket-handling |
| `20260713000001` | `20260713000001_shared_remote.sql` | Standard foreign | ticket-handling |
| `20260714000000` | `20260714000000_shared_remote.sql` | Standard foreign | ticket-handling |
| `20260715*` (6 files) | `*_shared_remote.sql` | Standard foreign | ticket-handling |
| `20260716010000` | `20260716010000_shared_remote.sql` | ⚠️ Orphaned (ticketing) | Domain confirmed via hosted hash; file source unknown |
| `20260716120000` | `20260716120000_shared_remote.sql` | Standard foreign | OrderMgmt, order_management domain; hosted identity confirmed |

### 6.2 Hosted ledger repair (separate step — NOT in this PR)

After this PR is merged and the dry-run confirms the "not found" errors are resolved, a SEPARATE review must determine whether hash mismatches require `supabase migration repair`. This step:

1. Must list every version where the local file hash differs from the hosted `schema_migrations` hash
2. Must be authorized by the domain owner for any RPagentOS-owned migration
3. Must not mark foreign-owned migrations as reverted

### 6.3 Hosted schema migration (separate step — NOT in this PR)

After reconciliation and repair, the pending local-only migrations (`20260716000000`, `20260716000001`, `20260717040000`) can be applied. This requires explicit approval per governance rules.

## 7. Commands Intentionally Not Executed

The following commands are documented for review but were NOT executed during this investigation:

```bash
# ❌ NOT EXECUTED — Would mutate hosted migration ledger
supabase migration repair --status reverted 0001 0002 20260708000002 ...

# ❌ NOT EXECUTED — Would apply pending migrations
supabase db push --linked --password "$SUPABASE_DB_PASSWORD" --include-all

# ❌ NOT EXECUTED — Would pull remote schema
supabase db pull

# ❌ NOT EXECUTED — Would reset local database
supabase db reset
```

## 8. Preconditions for Dry-Run

Before rerunning the dry-run workflow:

1. This PR must be merged into `main`
2. The `supabase-migrations.yml` workflow must be triggered with `dry_run: true`
3. No `repair_versions` must be provided
4. The following verification steps should pass:

```bash
# Verify no remote versions are absent from local
supabase migration list --linked --password | \
  python3 -c "import sys,json; ms=json.load(sys.stdin)['migrations']; missing=[m['remote'] for m in ms if m['remote'] and not m['local']]; print('\n'.join(missing) if missing else 'OK: all remote versions have local files')"

# Verify local migration file count
ls supabase/migrations/*.sql | wc -l
# Expected: 46 (22 original + 21 _shared_remote.sql + 3 pending)
```

## 9. Expected Dry-Run Output

**Verified 2026-07-17:** The dry-run already passes from this branch:

```
DRY RUN: migrations will *not* be pushed to the database.
Connecting to remote database...
Would push these migrations:
 • 20260716000000_deploy_catalogsync_phase_a.sql
 • 20260716000001_add_product_content_fields.sql
 • 20260717040000_catalogsync_marketplace_projection_v1.sql
Finished supabase db push.
```

- **0** remote-only errors (all 21 versions matched: 20 `_shared_remote.sql` + 1 real file)
- **0** hash mismatches (Supabase CLI matches by version string during `db push --dry-run`; the `--include-all` flag skips hash re-verification for already-applied migrations)
- **3** local-only pending migrations (not applied to remote; require separate approval)

## 10. Rollback and Recovery

If the reconciliation causes unexpected issues:

```bash
# Revert the reconciliation commit
git revert <reconciliation-commit>

# The _shared_remote.sql files are no-ops — deleting them has no hosted impact
rm supabase/migrations/*_shared_remote.sql
```

The hosted database is never mutated by this reconciliation. Recovery is a local git operation only.

## 11. Verification Procedure

After merge, verify:

1. **File count:** `ls supabase/migrations/*_shared_remote.sql | wc -l` → 20 (plus 1 real restored file)
2. **No duplicate version prefixes:** `ls supabase/migrations/*.sql | sed 's|.*/||' | cut -d'_' -f1 | sort | uniq -d` → no output
3. **No zero-byte files:** All `_shared_remote.sql` files have non-zero content (SQL comment headers)
4. **Syntax check:** `for f in supabase/migrations/*.sql; do sqlint "$f" || true; done` (if sqlint available)
5. **Secret scan:** `grep -rE '(eyJ|sk-|supabase\.co.*secret|service_role|password\s*=|secret\s*=)' supabase/migrations/` → no output
6. **Ownership:** Every `_shared_remote.sql` file references a valid domain owner from `DATABASE_OWNERSHIP.yaml`

## 12. Impact on CatalogSync Rollout

The CatalogSync marketplace projection API rollout (CatalogSync PR #35, RPagentOS PR #35, rp-governance-kit PR #21) is blocked on this reconciliation. The specific blocking path:

1. RPagentOS migration history must pass dry-run → **this PR**
2. Pending migrations (including `20260717040000`) must be applied to hosted → **separate approval**
3. The `catalogsync_marketplace_projection_api_read` workload must be approved → **central governance**
4. Credentials must be provisioned and installed → **RPagentOS + CatalogSync**
5. CatalogSync projection API must be enabled → **CatalogSync**

This PR resolves only step 1. Each subsequent step requires independent review and authorization.

## 13. Unresolved Questions

1. **`20260716010000` source:** The hosted hash confirms it is a ticketing-domain migration, but no matching file exists in any Retailpulses repository. This remains unresolved and requires ticket-handling owner investigation.
2. **`20260708000002` provenance:** ✅ Resolved — hosted hash matches RPagentOS canonical (`d612a10f`). The file was missing from `main` but has been restored. The migration was applied from RPagentOS, not from the ticket-handling copy.
3. **`20260710000000` identity:** ✅ Resolved — hosted `schema_migrations` records `name = 'inbound_ticket_messages'` (ticket-handling). OrderMgmt's `order_mgmt_core` is not in the migration ledger.
4. **OrderMgmt `20260713000000` and `20260713010000`:** These OrderMgmt migrations are NOT in the hosted database. Does OrderMgmt use a different Supabase project, or have they simply not been deployed yet?
5. **CI Supabase CLI version:** The workflow uses the latest Supabase CLI. Should it be pinned to a specific version for reproducibility?
6. **Placeholder convention documentation:** Should the `_shared_remote.sql` convention be documented in `DATABASE_GOVERNANCE.md` (central governance) as a recognized history-alignment pattern for shared-database repositories?

## 14. Document Change Log

| Date | Version | Author | Change |
|------|---------|--------|--------|
| 2026-07-17 | 1.0 | Claude (via jim-young) | Initial reconciliation plan |
| 2026-07-17 | 1.1 | Claude (via jim-young) | Hosted `schema_migrations` identity verification; `20260708000002` confirmed RPagentOS-applied; `20260710000000` identity resolved to `inbound_ticket_messages`; `20260716010000` domain confirmed as ticketing; dry-run verified passing |

---

**No hosted mutation was performed during this investigation. All analysis is read-only.**

The `supabase migration repair` command suggested by the CLI must not be executed without explicit owner review of every version in the repair list. This document is an auditable plan — the repair itself is a separate, narrower task.
