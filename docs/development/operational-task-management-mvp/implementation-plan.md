# Operational Task Management MVP Implementation Plan

Version: v0.1 draft
Date: 2026-07-02
Status: ready for review; do not implement until approved

## Locked Decisions

| Area | Decision |
|---|---|
| Frontend | Vite + React + TypeScript |
| Auth | No full auth or role management in MVP |
| Owners | `owner_type`: `human`, `agent`, `mixed`; `owner_key`: `jim`, `agent_listing`, `agent_promotion`, `external_operator` |
| Creator | `created_by`: `jim`, `system`, `agent` |
| Constraints | `text` columns with `check` constraints; no Postgres enums |
| Targets | Loose references only; no strict FK to products, listings, or accounts |
| Logs | Keep `task_logs` as task-scoped logs |
| Execution | No automatic production execution |

## Proposed Source Values

The user locked `source` as a constrained text field but did not define values. Proposed MVP values:

- `manual`
- `system`
- `agent`
- `import`
- `workflow`
- `external`

These values cover hand-created tasks, seeded/system-created tasks, future agent suggestions, imported task batches, workflow-generated tasks, and external operator/source-system references.

## Deliverables To Implement After Review

1. Supabase migration:
   - Convert `migration-draft.sql` into `supabase/migrations/<timestamp>_add_operational_task_management.sql`.
   - Do not alter existing promotion or agent-run tables except FK references from the new tables.

2. Seed data:
   - Add the approved sample rows from `seed-sample-tasks.sql` to `supabase/seed.sql` or a dedicated seed script.

3. Service functions:
   - Add plain Supabase JS service functions described in `api-service-design.md`.
   - Avoid adding an ORM for MVP.

4. Frontend:
   - Add Vite React TypeScript app, recommended at `apps/web`.
   - Build four views: Today, Board, Task Detail, Create Task.

5. Safety:
   - Keep `execution_brief` display-only.
   - Do not add buttons or endpoints that write to Mercari, Rakuten, Amazon, Baserow, or other production systems.

## Supabase Tables

Implement:

- `tasks`
- `task_targets`
- `task_steps`
- `task_comments`
- `task_logs`

The exact SQL is in `migration-draft.sql`.

## Minimal Service/API Layer

Implement service functions first, then UI. Recommended files:

```text
src/lib/task-types.ts
src/lib/tasks.ts
```

The service layer should provide:

- `listTasks(filters)`
- `getTaskDetail(id)`
- `createTask(input)`
- `updateTask(id, input)`
- `updateTaskStatus(id, status)`
- `linkTarget(taskId, input)`
- `unlinkTarget(taskId, targetRowId)`
- `createStep(taskId, input)`
- `updateStep(stepId, input)`
- `addComment(taskId, input)`
- `addTaskLog(taskId, input)`

Full function shapes are in `api-service-design.md`.

## UI Structure

Recommended frontend location:

```text
apps/web
```

Recommended page/component structure is in `ui-page-structure.md`.

Routes:

- `/today`
- `/board`
- `/tasks/new`
- `/tasks/:id`

Default route:

- `/` should open or redirect to `/today`.

## Seed Sample Tasks

Seed coverage should include:

| Type | Status | Priority | Purpose |
|---|---|---|---|
| `product` | `in_progress` | `high` | Product data cleanup |
| `promotion` | `waiting_approval` | `urgent` | Approval-gated promotion |
| `listing` | `planned` | `medium` | Listing optimization |
| `account` | `blocked` | `low` | Account/admin blocker |
| `workflow` | `backlog` | `medium` | Future agent workflow |
| `listing` | `done` | `high` | Completed operational task |
| `promotion` | `canceled` | `low` | Canceled campaign idea |

The exact sample SQL is in `seed-sample-tasks.sql`.

## Implementation Phases

### Phase 1: Database

- Create migration from `migration-draft.sql`.
- Add seed rows.
- Run `npm run db:reset`.
- Run a smoke query for tasks with targets, steps, comments, and logs.

### Phase 2: Services

- Add TypeScript types.
- Add Supabase service functions.
- Add a small smoke script or test to query the seeded tasks.

### Phase 3: Frontend Scaffold

- Create Vite React TypeScript app under `apps/web`.
- Wire Supabase environment variables.
- Add app shell and navigation.

### Phase 4: Core Views

- Implement Today / This Week.
- Implement Board.
- Implement Create Task.
- Implement Task Detail.

### Phase 5: Guardrails and QA

- Verify no production write integrations exist.
- Verify approval-required tasks are visually distinct.
- Verify task cards and detail pages satisfy acceptance checklist.

## Review Required Before Code

Before runtime implementation starts, review:

- `source` CHECK values.
- `apps/web` as frontend location.
- Whether `completed_at` should be required for `done` status. The draft migration currently enforces it.
- Whether `task_logs.run_id` should keep its optional FK to `agent_runs`. It does not merge logs; it only provides traceability when a task is related to a run.

## Version Change Log

| Version | Date | Change |
|---|---|---|
| v0.1 | 2026-07-02 | Initial locked implementation plan |
