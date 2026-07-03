# Operational Task Management MVP Implementation Backlog

Version: v0.2 draft
Date: 2026-07-02

## Development Sequence

### Phase 0: Finalize Decisions

- Confirm reviewed implementation plan.
- Confirm proposed `source` CHECK values: `manual`, `system`, `agent`, `import`, `workflow`, `external`.
- Confirm Vite app location: repo root or `apps/web`.

Exit criteria:

- Locked decisions are recorded.
- Migration approach is approved.

### Phase 1: Database

- Convert `schema-proposal.sql` into a Supabase migration.
- Apply migration locally with `npm run db:reset`.
- Add seed tasks covering:
  - product task
  - promotion task
  - listing task
  - account task
  - workflow task
  - waiting approval task
  - blocked task
- Add a read smoke test that queries tasks with targets, steps, comments, and logs.

Exit criteria:

- Local Supabase reset succeeds.
- Seed data can be queried.
- Constraints reject invalid `task_type`, `status`, and `priority`.

### Phase 2: API or Data Access Layer

- Add task list query.
- Add task detail query with related rows.
- Add create task mutation.
- Add update task mutation.
- Add status transition mutation.
- Add target link/unlink mutation.
- Add step create/update mutation.
- Add comment create mutation.
- Add task log create helper.

Exit criteria:

- All task pages can be powered without direct ad hoc queries in UI components.
- Writes create appropriate task logs where useful.

### Phase 3: Frontend Shell

- Add app routing and base layout.
- Add navigation for:
  - Today
  - Board
  - Create Task
- Use compact, operator-oriented UI.
- Avoid marketing-style pages.

Exit criteria:

- Local dev server opens directly into the task management workflow.

### Phase 4: Today / This Week View

- Show overdue tasks.
- Show due today.
- Show scheduled today.
- Show due this week.
- Show waiting approval.
- Show blocked tasks.
- Add filters for platform, shop, owner, and task type.

Exit criteria:

- Jim can see the immediate operational workload without opening the board.

### Phase 5: Task Board

- Add columns for all MVP statuses.
- Render task cards with required fields.
- Support status updates.
- Preserve due date, priority, owner, and target summary visibility.

Exit criteria:

- Jim can triage and move tasks across the workflow.

### Phase 6: Create Task

- Add create form with required and optional fields.
- Support adding initial targets.
- Support adding initial steps.
- Validate required fields and allowed values.

Exit criteria:

- Jim can create a task connected to a shop/platform/business object.

### Phase 7: Task Detail

- Show full task context.
- Show related targets grouped by type.
- Show description and execution brief.
- Show steps.
- Show comments.
- Show logs.
- Make approval-gated state obvious.

Exit criteria:

- The detail page contains enough context for a human to act or approve.

### Phase 8: Approval-Gating Guardrails

- Ensure no task UI calls production platform APIs.
- Ensure future execution state is informational only.
- Add visible approval state for approval-required tasks.
- Add log events for manual approval state changes if implemented.

Exit criteria:

- MVP cannot accidentally execute production changes.

## Suggested File Targets

Frontend stack is Vite + React + TypeScript because the repo has no existing frontend stack. Recommended path is `apps/web` so current script-first RPagentOS files stay stable.

```text
supabase/migrations/<timestamp>_add_operational_task_management.sql
supabase/seed.sql
src/lib/task-types.ts
src/lib/tasks.ts
apps/web/src/App.tsx
apps/web/src/main.tsx
apps/web/src/pages/Today.tsx
apps/web/src/pages/Board.tsx
apps/web/src/pages/CreateTask.tsx
apps/web/src/pages/TaskDetail.tsx
apps/web/src/components/TaskCard.tsx
apps/web/src/components/TaskFilters.tsx
apps/web/src/components/TaskTargets.tsx
apps/web/src/components/TaskSteps.tsx
apps/web/src/components/TaskActivity.tsx
```

If keeping this repo script-first temporarily, add the migration and smoke scripts first, then scaffold UI in a follow-up.

## Risks

| Risk | Mitigation |
|---|---|
| Generic TODO behavior | Require targets, shop/platform context, and execution brief support |
| Weak future agent model | Include `approval_required`, `execution_brief`, `agent_run_id`, logs, and target links now |
| Over-strict target FKs block integration | Use flexible target refs in MVP, add stricter FKs later where stable |
| UI becomes too broad | Ship Today, Board, Create, and Detail only |
| Accidental production writes | Keep execution informational and approval-gated in MVP |

## Version Change Log

| Version | Date | Change |
|---|---|---|
| v0.2 | 2026-07-02 | Locked Vite React TypeScript plan and updated implementation file targets |
| v0.1 | 2026-07-02 | Initial implementation backlog |
