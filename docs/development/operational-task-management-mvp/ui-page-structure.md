# Operational Task Management UI Page Structure

Version: v0.1 draft
Date: 2026-07-02
Status: design only; do not implement until approved

## Frontend Stack

Use Vite + React + TypeScript. The current RPagentOS repo has no existing frontend stack.

Recommended location:

```text
apps/web
```

## Routes

| Route | Page | Purpose |
|---|---|---|
| `/` | redirect/open `/today` | Operator default entry |
| `/today` | Today | Today / This Week workload |
| `/board` | Board | Status board |
| `/tasks/new` | CreateTask | Manual task creation |
| `/tasks/:id` | TaskDetail | Full task context |

Use `react-router-dom` if adding a routing dependency is acceptable during implementation. Otherwise use a simple hash router for the MVP.

## File Structure

```text
apps/web/
  index.html
  package.json
  src/
    App.tsx
    main.tsx
    pages/
      Today.tsx
      Board.tsx
      CreateTask.tsx
      TaskDetail.tsx
    components/
      Layout.tsx
      TaskCard.tsx
      TaskFilters.tsx
      TaskTargets.tsx
      TaskSteps.tsx
      TaskActivity.tsx
      StatusBadge.tsx
      PriorityBadge.tsx
    hooks/
      useTasks.ts
```

Shared data functions remain in repo-level `src/lib/tasks.ts` unless implementation discovers that a web-local copy is cleaner for Vite import boundaries.

## Page Requirements

### Today

Show grouped task lists:

- Overdue
- Due today
- Scheduled today
- Due this week
- Waiting approval
- Blocked

Default sort:

1. Priority: urgent, high, medium, low.
2. Overdue first.
3. Scheduled start time.
4. Due date.

### Board

Columns:

- Backlog
- Planned
- In Progress
- Waiting Approval
- Blocked
- Done
- Canceled

MVP may use click-to-change status instead of drag and drop.

### Create Task

Required fields:

- title
- task_type
- priority

Optional fields:

- description
- platform
- shop_code
- owner_type
- owner_key
- due_date
- scheduled_start_at
- source
- approval_required
- execution_brief
- initial target
- initial steps

### Task Detail

Sections:

- Header: title, status, priority, owner, due dates.
- Business context: task type, platform, shop code, source.
- Targets: grouped related business objects.
- Execution: approval state and execution brief.
- Steps: ordered checklist.
- Activity: comments and logs.

## Task Card

Required visible fields:

- title
- task_type
- platform
- shop_code
- priority
- status
- due_date
- owner_type
- related targets summary

Recommended additional fields:

- owner_key
- approval-required indicator
- overdue indicator

## UI Safety Rules

- Do not include production execution controls.
- Do not include marketplace-write buttons.
- Treat `execution_brief` as display-only text.
- Approval state can be displayed and edited, but must not trigger external actions.

## Version Change Log

| Version | Date | Change |
|---|---|---|
| v0.1 | 2026-07-02 | Initial Vite React TypeScript UI structure |
