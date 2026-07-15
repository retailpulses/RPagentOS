# Database Governance (Local Reference)

This file is the repository-local entrypoint for Retailpulses database governance. It is installed and updated by `rp-governance-kit`.

**Canonical policy:** [`retailpulses/rp-governance-kit` → `docs/DATABASE_GOVERNANCE.md`](https://github.com/retailpulses/rp-governance-kit/blob/main/docs/DATABASE_GOVERNANCE.md)

**Canonical workload registry:** [`retailpulses/rp-governance-kit` → `docs/DATABASE_WORKLOADS.yaml`](https://github.com/retailpulses/rp-governance-kit/blob/main/docs/DATABASE_WORKLOADS.yaml)

**Canonical incident response:** [`retailpulses/rp-governance-kit` → `docs/DATABASE_INCIDENT_RESPONSE.md`](https://github.com/retailpulses/rp-governance-kit/blob/main/docs/DATABASE_INCIDENT_RESPONSE.md)

**Canonical ownership registry:** [`retailpulses/rp-governance-kit` → `docs/DATABASE_OWNERSHIP.yaml`](https://github.com/retailpulses/rp-governance-kit/blob/main/docs/DATABASE_OWNERSHIP.yaml)

**Installed governance ref:** `main`
**Installed at:** `2026-07-15T15:51:34Z`

---

## What This File Is

- An entrypoint that agents must read before database-related work.
- A pointer to the canonical central policy, which is the source of truth.
- This file may be updated by `rp-governance-install` during governance upgrades.

## What This File Is Not

- A copy of the full canonical policy.
- A replacement for `docs/DATABASE_OWNERSHIP.yaml`.
- A replacement for `docs/DATABASE_WORKLOADS.yaml`.
- A substitute for the repository-specific declarations in `docs/16_DATABASE_GOVERNANCE.local.md`.

## Agent Instructions

1. Before any Supabase, migration, schema, RLS, Storage, or generated-types work, read this file.
2. Follow the canonical policy at `docs/DATABASE_GOVERNANCE.md` in `rp-governance-kit`.
3. Read `docs/16_DATABASE_GOVERNANCE.local.md` for repository-specific declarations and exemptions.
4. Read `docs/DATABASE_OWNERSHIP.yaml` in `rp-governance-kit` for domain ownership.
5. Read `docs/DATABASE_WORKLOADS.yaml` in `rp-governance-kit` before running any recurring or bulk database workload.
6. Read `docs/DATABASE_INCIDENT_RESPONSE.md` in `rp-governance-kit` before performing any emergency database action.
7. If this file conflicts with the canonical central policy, stop and report the conflict. The central policy wins unless this repository's rules are stricter.
8. If the installed governance ref recorded here differs from the canonical `@main`, report the version skew before proceeding.

### Required Reading by Operation Type

| Operation | Policy sections to read |
|-----------|------------------------|
| Production query (read-only) | DATABASE_GOVERNANCE.md §6, §13, §14 |
| Production query (write/DML) | DATABASE_GOVERNANCE.md §6, §8, §13, §14 |
| Import / bulk load | DATABASE_GOVERNANCE.md §6, §13.3, §13.9, §13.10, §13.11, §14; DATABASE_WORKLOADS.yaml |
| Sync (external→internal) | DATABASE_GOVERNANCE.md §6, §13.3, §13.9, §13.10, §13.11, §14; DATABASE_WORKLOADS.yaml |
| Catalog or bulk loop processing | DATABASE_GOVERNANCE.md §13.9, §13.10, §13.11; DATABASE_WORKLOADS.yaml |
| Backfill / data migration | DATABASE_GOVERNANCE.md §5, §6, §13; DATABASE_WORKLOADS.yaml |
| Scheduled / cron job setup | DATABASE_GOVERNANCE.md §6, §13.3, §13.9, §13.10, §13.12, §13.13, §13.14, §14; DATABASE_WORKLOADS.yaml |
| High-risk workload rollout | DATABASE_GOVERNANCE.md §13.8, §13.13, §13.14; DATABASE_WORKLOADS.yaml |
| Agent-managed DB operation | DATABASE_GOVERNANCE.md §6, §8, §13.9, §13.11 |
| Maintenance (VACUUM, REINDEX) | DATABASE_GOVERNANCE.md §6, §13, §14; DATABASE_WORKLOADS.yaml |
| Diagnostics (EXPLAIN, drift) | DATABASE_GOVERNANCE.md §6, §12 |
| Compute resize | DATABASE_GOVERNANCE.md §14; DATABASE_WORKLOADS.yaml |
| Compute downgrade | DATABASE_GOVERNANCE.md §14; DATABASE_WORKLOADS.yaml |
| Emergency incident | DATABASE_GOVERNANCE.md §10; DATABASE_INCIDENT_RESPONSE.md |
| Schema migration | DATABASE_GOVERNANCE.md §3, §4, §5, §6, §8 |
| RLS / access class change | DATABASE_GOVERNANCE.md §8 |
| Generated types update | DATABASE_GOVERNANCE.md §9 |

## Repository Declaration

See `docs/16_DATABASE_GOVERNANCE.local.md` for this repository's specific declaration:

- **Supabase consumer:** yes / no
- **Migration owner:** yes / no
- **Owned domains:** (from `DATABASE_OWNERSHIP.yaml`)
- **Consumed shared domains:** (from `DATABASE_OWNERSHIP.yaml`)
- **Generated types:** path or exemption
- **Deployment authority:** who can approve hosted writes
- **Database environment model:** shared / dedicated / local-only

## Repository Workload Declaration

Repositories that contain database-writing code (Workers, scripts, cron jobs, syncs, imports) must maintain a section in `docs/16_DATABASE_GOVERNANCE.local.md` declaring each workload:

- **Workload ID:** unique identifier matching an entry in `docs/DATABASE_WORKLOADS.yaml` (canonical registry)
- **Category:** imports | syncs | backfills | scheduled_jobs | agent_operations | maintenance | diagnostics
- **Risk level:** low | medium | high
- **Trigger:** cron expression, manual, event-driven, or on-deploy
- **Kill-switch method:** how to abort safely
- **Approval:** who authorized this workload in this repository
- **Workload declaration reference:** link to the corresponding entry in `DATABASE_WORKLOADS.yaml` or the Issue that authorized a one-off workload

Workloads that do not yet have a canonical registry entry in `DATABASE_WORKLOADS.yaml` must be declared as one-off in `docs/16_DATABASE_GOVERNANCE.local.md` with the same fields, and an Issue must be filed to register them in the canonical registry.

Repositories that do not host any database-writing workloads should state:

> **Workload declaration:** This repository has no database-writing workloads. All database access is read-only or mediated through an internal API that handles workload safety in its owning repository.

## Quick Reference

| Rule | Summary |
|------|---------|
| Migration naming | `YYYYMMDDHHMMSS_description.sql` — unique across all Retailpulses repos |
| Migration header | Domain, owner, affected objects, change class, hosted write required |
| Access classes | `worker_only`, `authenticated_user`, `public_read`, `internal_admin` |
| RLS | Evaluated against declared access class; `worker_only` may have no client policies |
| Hosted writes | Require explicit approval; never combine audit and remediation |
| CLI | CI must pin version; local version recorded in `.local.md` |
| Generated types | Required for direct Supabase clients; exemption available for API-only consumers |
| Workload registry | Recurring workloads must be registered in `DATABASE_WORKLOADS.yaml` |
| N+1 prohibition | No per-record DB/API lookups in loops; use bulk retrieval; declare max_requests_per_invocation and max_requests_per_1000_input_rows |
| Change-aware writes | Periodic scans must not rewrite unchanged rows for per-row timestamps; prefer run-level freshness |
| Access path | Every workload must declare `internal_api`, `supavisor`, `postgrest`, or `direct_postgres` |
| Release mapping | Scheduled production workloads must map to a reviewed Git commit; no untracked VPS source |
| Rollout gates | High-risk: zero-write dry-run → bounded canary → manual full run → ≥2 healthy scheduled cycles |
| Run health independence | Current-run health not based on historical alerts; separate this-run metrics from known debt |
| Batch safety | Max 10,000 rows per statement; cursor-based pagination for reads over 100k rows |
| Retries | Max 3 per unit of work; exponential backoff with jitter |
| Kill switches | Documented and tested for every Medium/High workload |
| Observability | Capture: requests by operation, rows read/compared, business_rows_changed, rows_written, unchanged_rows_written, unchanged_write_ratio, batches, runtime, retries/dead letters |
| Incident response | See `DATABASE_INCIDENT_RESPONSE.md`; capture evidence before mitigation |

---

*This file is part of the Retailpulses governance kit. Do not edit manually — it is updated by `rp-governance-install`. Repository-specific declarations belong in `docs/16_DATABASE_GOVERNANCE.local.md`.*
