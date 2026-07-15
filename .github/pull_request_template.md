## Linked Issue

<!-- Reference the GitHub Issue this PR addresses -->
<!-- Must use one of: Refs #..., Related to #..., Issue #..., Closes #..., Fixes #..., Resolves #... -->

## What Changed

<!-- Brief description of the changes -->

## Why

<!-- Motivation for the change -->

## User Impact

<!-- How does this affect end users? -->

- [ ] No user-facing change
- [ ] Changes user workflow — describe:

## System Impact

<!-- Does this change system structure, APIs, or agent workflows? -->

- [ ] No system impact
- [ ] Database migration
- [ ] Schema/types changed
- [ ] Routes/pages changed
- [ ] Agent configuration changed
- [ ] Other:

## Data Model Impact

<!-- Does this require new tables, columns, or migrations? -->

- [ ] No data model changes
- [ ] Existing tables reused
- [ ] New tables/columns added — justify:

## Governance Standards Review

- [ ] Issue governance passed before work
- [ ] Engineering principles followed
- [ ] Frontend standards followed (or N/A)
- [ ] Frontend stack follows React + Vite + TypeScript (or N/A)
- [ ] If frontend stack differs, exception documented (or N/A)
- [ ] Supabase / secrets access safe (or N/A)
- [ ] No new Baserow dependency introduced
- [ ] No new Cloudflare-specific coupling introduced
- [ ] Existing canonical tables reused before creating new tables (or N/A)
- [ ] Documentation updated where needed

## Documentation Impact

- [ ] No docs changes needed
- [ ] docs/00_CURRENT_STATE.md updated
- [ ] docs/05_DECISION_LOG.md updated
- [ ] docs/10_ENGINEERING_PRINCIPLES.md applicable
- [ ] docs/11_FRONTEND_STANDARDS.md applicable
- [ ] docs/12_DATA_ACCESS_AND_SECRETS.md applicable
- [ ] docs/13_PLATFORM_DEPENDENCY_POLICY.md applicable
- [ ] docs/14_ISSUE_GOVERNANCE.md applicable
- [ ] Other docs updated:

## Verification

<!-- How was this tested? -->

- [ ] Typecheck passes
- [ ] Build passes
- [ ] Tests pass
- [ ] Manually verified

## Runtime Database Impact

<!-- Does this change introduce or modify database workloads at runtime? -->
<!-- Applies to: Workers, scripts, cron jobs, syncs, imports, backfills, agent operations -->

- [ ] No runtime database impact
- [ ] Changes existing database workload — describe:
- [ ] Adds new database-writing code (Worker, script, cron, sync, import)
- [ ] Adds new scheduled/background job that touches the database
- [ ] Adds bulk insert/update/delete (>1,000 rows)
- [ ] Changes connection pooling or concurrency behavior
- [ ] Changes statement timeout or retry configuration

### Workload Declaration

<!-- If this PR adds or changes a database workload, describe: -->

- **Workload category:** imports | syncs | backfills | scheduled_jobs | agent_operations | maintenance | diagnostics
- **Affected tables:**
- **Expected row volume per invocation:**
- **Expected request count per invocation:** (total DB/API requests)
- **Expected runtime (seconds):**
- **Concurrency max:**
- **Statement timeout (ms):**
- **Retry strategy:**
- **Batch size:**
- **Access path:** internal_api | supavisor | postgrest | direct_postgres
- **Source commit/release:** (must be a reviewed, reproducible Git SHA or release tag)
- **Kill-switch method:**
- **Kill-switch identifier:** (config key, cron name, or timer name)
- **Workload registry entry:** (link to `docs/DATABASE_WORKLOADS.yaml` or Issue for one-off)
- [ ] Workload registry updated in `docs/DATABASE_WORKLOADS.yaml` (if recurring)
- [ ] Workload declared in `docs/16_DATABASE_GOVERNANCE.local.md` (if repo-local)
- [ ] Dry-run or shadow-database test evidence attached

### N+1 Lookup Safeguard

<!-- Required for workloads that iterate over input items -->

- [ ] No N+1 lookups — all database/API calls use bulk retrieval (IN clause, batch endpoint, cursor pagination)
- [ ] N+1 is unavoidable — explicit justification and request-count budget declared:
  - **Request budget per invocation:** (absolute ceiling on total DB/API requests per run)
  - **Max requests per 1,000 input rows:** (must scale with input; formula must be documented)
  - **Bulk fetch strategy:** IN-clause-batch | bulk-endpoint | pagination-cursor | none
  - **Justification:**

### Change-Aware Write Strategy

<!-- Required for workloads that scan then write back to the database -->

- [ ] Not applicable — this workload does not perform scan-then-write
- [ ] Change-aware writes implemented — business columns are compared before writing
- [ ] Run-level freshness used — no per-row freshness timestamps written
- [ ] Per-row freshness required — explicit justification:
  - **Freshness strategy:** run_level | per_row
  - **Unchanged-write ratio target:** (ratios above this trigger review; target 0.0 for catalog syncs)
  - **Justification:**

### Rollout Gate Plan (High-Risk Workloads)

<!-- Required for any high-risk or new database-writing workload -->

- [ ] Not applicable — this change does not introduce high-risk database writes
- [ ] Zero-write dry-run completed — evidence attached
- [ ] Bounded live canary planned:
  - **Canary row limit:**
  - **Approval required from:**
- [ ] Manual full run planned — trigger method documented
- [ ] Healthy cycle requirement: (minimum 2) scheduled cycles before operational
- [ ] Re-enable gate: explicit approval required (if previously disabled by incident)
- [ ] Incident reference: (if workload is being re-enabled after an incident)

### Operational Budget

<!-- Estimate the operational cost of this workload on database resources -->

- **Peak connections consumed:**
- **Sustained connections consumed:**
- **Disk I/O impact:** low | medium | high
- **CPU impact:** low | medium | high
- **Expected growth rate (monthly):** (rows/data volume)
- [ ] Budget reviewed against current plan limits (see Supabase Dashboard)
- [ ] Downgrade plan documented if compute tier change was required
- [ ] Monitoring dashboard or alert configured

## Risks for Jim to Review

<!-- Jim mainly reviews: business logic assumptions, user workflow impact, data model naming/reuse, whether current state docs remain true, whether the change conflicts with existing architecture direction -->

*What should Jim pay attention to?*

## Suggested Review Focus

*Which areas need the most scrutiny?*
