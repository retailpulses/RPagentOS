# Current State

## Repository role — 2026-09-04 direction

RPagentOS currently contains two materially different responsibilities. They must be treated as separate architectural roles even while they remain in one repository.

### Role A — Shared Domain Owner: ACTIVE / STABLE

RPagentOS is currently the physical migration and contract owner for shared domains, most importantly `product_catalog`.

This role includes owner-side schema/migrations and the narrow views, roles, Auth mappings and owner APIs used by external consumers such as CatalogSync and ticket-handling.

Near-term rule:

- preserve existing production consumer contracts;
- no Product Catalog repository migration yet;
- no rename/drop/move of externally consumed objects as cleanup;
- shared-domain schema changes require an explicit domain requirement and consumer-impact review;
- no consumer gains ownership of shared schema merely because it executes a workload.

See `docs/architecture/EXTERNAL_CONSUMER_CONTRACTS.md` and #104 for the dependency safety map.

### Role B — Agent OS Application: FROZEN / MAINTENANCE

The application/product layer is frozen from feature expansion while its long-term value and placement are reassessed.

Near-term rule:

- do not default new business capabilities into RPagentOS;
- do not add new owned domains without an explicit architecture decision;
- existing production features may receive maintenance, reliability and safety fixes;
- existing non-core domains/features will later be classified `KEEP`, `MOVE LATER`, or `RETIRE`;
- experimental capabilities whose permanent owner is unclear should use an appropriate business repository or `retailpulses/inbox` rather than expanding Agent OS by default.

This is a scope freeze, not a shutdown. Existing production behavior and consumer contracts remain supported.

Tracking: #103.

## Production

| Item | Value |
|------|-------|
| Production URL | `https://agent.homesbliss.net` |
| Staging URL | <!-- URL(s) for staging --> |
| Database | <!-- e.g. Supabase project ref --> |
| Frontend | React SPA deployed on Cloudflare Pages |
| Backend | Cloudflare Pages Functions with server-side Supabase access |

## Account Metrics MVP

- `/metrics` shows complete-month KPIs, trends, monthly history, and deterministic management signals for active platform accounts.
- The default “All Mercari Shops” view combines shop1–shop4 only for months where every shop has exactly one valid complete metric row. Additive KPIs are summed; CVR and purchase value are derived from combined totals.
- Partial periods are displayed as provisional context but excluded from month-over-month comparisons and signal generation.
- The browser calls the same-origin public read-only `/api/account-metrics` Pages Function; the Supabase `service_role` credential remains server-side.
- “Plan task” and “Start project” prefill the existing forms with account and signal context. A manager must review and submit them manually; the dashboard performs no marketplace action.

## Known Limitations

- Account metrics are visible to anyone who can access `agent.homesbliss.net`; per-user authorization is not implemented.
- Metrics are refreshed from imported monthly source files; the MVP does not fetch Mercari analytics automatically.

## Next Milestone

Stabilize the shared-domain ownership boundary and complete the external consumer/contract audit before considering any RPagentOS squeeze, domain extraction, repository merge, or retirement work. New Agent OS application feature expansion is not a milestone.