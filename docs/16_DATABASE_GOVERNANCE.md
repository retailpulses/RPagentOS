# Database Governance (Local Reference)

This file is the repository-local entrypoint for Retailpulses database governance. It is installed and updated by `rp-governance-kit`.

**Canonical policy:** [`retailpulses/rp-governance-kit` → `docs/DATABASE_GOVERNANCE.md`](https://github.com/retailpulses/rp-governance-kit/blob/v1.1.0/docs/DATABASE_GOVERNANCE.md)

**Canonical ownership registry:** [`retailpulses/rp-governance-kit` → `docs/DATABASE_OWNERSHIP.yaml`](https://github.com/retailpulses/rp-governance-kit/blob/v1.1.0/docs/DATABASE_OWNERSHIP.yaml)

**Installed governance ref:** `v1.1.0`
**Installed at:** `2026-07-15T04:47:33Z`

---

## What This File Is

- An entrypoint that agents must read before database-related work.
- A pointer to the canonical central policy, which is the source of truth.
- This file may be updated by `rp-governance-install` during governance upgrades.

## What This File Is Not

- A copy of the full canonical policy.
- A replacement for `docs/DATABASE_OWNERSHIP.yaml`.
- A substitute for the repository-specific declarations in `docs/16_DATABASE_GOVERNANCE.local.md`.

## Agent Instructions

1. Before any Supabase, migration, schema, RLS, Storage, or generated-types work, read this file.
2. Follow the canonical policy at `docs/DATABASE_GOVERNANCE.md` in `rp-governance-kit`.
3. Read `docs/16_DATABASE_GOVERNANCE.local.md` for repository-specific declarations and exemptions.
4. Read `docs/DATABASE_OWNERSHIP.yaml` in `rp-governance-kit` for domain ownership.
5. If this file conflicts with the canonical central policy, stop and report the conflict. The central policy wins unless this repository's rules are stricter.
6. If the installed governance ref recorded here differs from the canonical `@main`, report the version skew before proceeding.

## Repository Declaration

See `docs/16_DATABASE_GOVERNANCE.local.md` for this repository's specific declaration:

- **Supabase consumer:** yes / no
- **Migration owner:** yes / no
- **Owned domains:** (from `DATABASE_OWNERSHIP.yaml`)
- **Consumed shared domains:** (from `DATABASE_OWNERSHIP.yaml`)
- **Generated types:** path or exemption
- **Deployment authority:** who can approve hosted writes
- **Database environment model:** shared / dedicated / local-only

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

---

*This file is part of the Retailpulses governance kit. Do not edit manually — it is updated by `rp-governance-install`. Repository-specific declarations belong in `docs/16_DATABASE_GOVERNANCE.local.md`.*
