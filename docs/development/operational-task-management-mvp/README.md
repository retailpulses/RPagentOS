# Operational Task Management MVP Development Package

Version: v0.2 draft
Date: 2026-07-02
Owner: Retailpulses GK
Module: Operational Task Management

## Purpose

Operational Task Management is the human-first task center for RPagentOS. It connects ecommerce operational work to the business objects that matter: shops, products, listings, promotions, accounts, and workflows.

This package prepares development for the MVP module. It does not implement runtime code yet.

## Job-Specific Definition of Done

This preparation task is done when:

- The provided requirements are reviewed and converted into implementation-ready scope.
- Supabase table design is mapped to the current RPagentOS schema direction.
- UI pages and user workflows are defined.
- Agent-readiness and approval-gating requirements are explicit.
- Development tasks and acceptance checks are saved in the workspace.
- Open decisions are separated from implementation assumptions.

## Package Files

| File | Purpose |
|---|---|
| `module-spec.md` | Product and behavior specification for the MVP module |
| `schema-proposal.sql` | Proposed Supabase DDL for review before migration |
| `implementation-backlog.md` | Development tasks grouped by phase |
| `acceptance-checklist.md` | Testable completion criteria |
| `implementation-plan.md` | Locked implementation plan for review |
| `migration-draft.sql` | Draft migration SQL, not yet applied |
| `seed-sample-tasks.sql` | Draft sample seed data, not yet applied |
| `api-service-design.md` | Minimal Supabase service/API function design |
| `ui-page-structure.md` | Vite React TypeScript page and component plan |

## Development Stance

This module should not be treated as a generic TODO app. It is an RPagentOS control-plane module:

```text
Business object -> operational task -> human review -> approval-gated agent execution -> audit log
```

MVP supports manual task management. Agent fields exist now so future agent workers can pick up approved tasks without redesigning the data model.

## Current Repo Fit

The current RPagentOS repo already has:

- Supabase migrations.
- Product, variant, listing, promotion candidate, approval, execution-log, import-error, and agent-run concepts.
- Script-based workflows.
- No existing frontend app shell.

Therefore development should start in two tracks:

1. Database migration for operational tasks.
2. Minimal frontend/API scaffold for task views.

## Locked MVP Decisions

The following decisions are locked for the first implementation pass:

- Frontend stack: Vite + React + TypeScript. The repo has no existing frontend stack.
- Auth and roles: no full auth or role management in MVP.
- Owner fields: `owner_type` and `owner_key`, both string-based.
- Creator field: `created_by`, string-based.
- Constraints: use `text` columns with `check` constraints, not Postgres enum types.
- Target references: loose references in `task_targets`; no strict foreign keys to product/listing/account tables yet.
- Logs: keep `task_logs` as a separate task-scoped table.
- Production safety: no automatic production execution in MVP.

## Implementation Plan

The implementation plan is saved in:

- `implementation-plan.md`
- `migration-draft.sql`
- `seed-sample-tasks.sql`
- `api-service-design.md`
- `ui-page-structure.md`

## Version Change Log

| Version | Date | Change |
|---|---|---|
| v0.2 | 2026-07-02 | Locked implementation decisions and linked planning artifacts |
| v0.1 | 2026-07-02 | Initial development package created from user requirements |
