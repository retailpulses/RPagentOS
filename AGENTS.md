# AGENTS.md — RPagentOS

## Database Governance

Before any Supabase, migration, schema, RLS, Storage, or generated-types work:

1. Read `docs/16_DATABASE_GOVERNANCE.md` — the local entrypoint
2. Follow the canonical policy at `retailpulses/rp-governance-kit` → `docs/DATABASE_GOVERNANCE.md`
3. Read `docs/16_DATABASE_GOVERNANCE.local.md` for this repository's declarations
4. Check `docs/DATABASE_OWNERSHIP.yaml` in `rp-governance-kit` for domain ownership

**Central governance wins unless repo rules are stricter. If there is a conflict, stop and report it.**

This repository owns the majority of shared database domains (product_catalog, agent_os, task_management, project_management, listing_intelligence, listing_quality). Do not modify objects owned by other repositories without an explicit cross-domain exception and an Issue.

Migration naming: `YYYYMMDDHHMMSS_description.sql` — unique across all Retailpulses repos.
