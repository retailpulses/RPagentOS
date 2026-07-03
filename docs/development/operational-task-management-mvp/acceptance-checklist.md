# Operational Task Management MVP Acceptance Checklist

Version: v0.2 draft
Date: 2026-07-02

## Database Acceptance

- [ ] `tasks` table exists.
- [ ] `task_targets` table exists.
- [ ] `task_steps` table exists.
- [ ] `task_comments` table exists.
- [ ] `task_logs` table exists.
- [ ] `tasks` includes all required user-requested fields.
- [ ] `tasks.owner_type` supports `human`, `agent`, and `mixed`.
- [ ] `tasks.owner_key` supports `jim`, `agent_listing`, `agent_promotion`, and `external_operator`.
- [ ] `tasks.created_by` supports `jim`, `system`, and `agent`.
- [ ] `tasks.source` uses text with a CHECK constraint.
- [ ] `tasks` includes agent-ready fields or has a documented reason for excluding them.
- [ ] Invalid `task_type` values are rejected.
- [ ] Invalid `status` values are rejected.
- [ ] Invalid `priority` values are rejected.
- [ ] Invalid `owner_type` values are rejected.
- [ ] Invalid `source` values are rejected.
- [ ] Task targets use loose references and do not require strict product/listing/account foreign keys.
- [ ] Task targets include `task_id`, `target_type`, `target_id`, `target_label`, and `target_ref_json`.
- [ ] Task detail can be loaded with targets, steps, comments, and logs.

## UI Acceptance

- [ ] Today / This Week page exists.
- [ ] Task Board page exists.
- [ ] Task Detail page exists.
- [ ] Create Task page exists.
- [ ] Task cards show title.
- [ ] Task cards show task type.
- [ ] Task cards show platform.
- [ ] Task cards show shop code.
- [ ] Task cards show priority.
- [ ] Task cards show status.
- [ ] Task cards show due date.
- [ ] Task cards show owner type.
- [ ] Task cards show related targets summary.
- [ ] Task detail shows business context.
- [ ] Task detail shows related targets.
- [ ] Task detail shows description.
- [ ] Task detail shows execution brief.
- [ ] Task detail shows steps.
- [ ] Task detail shows comments.
- [ ] Task detail shows logs.

## Workflow Acceptance

- [ ] Jim can create a manual task.
- [ ] Jim can attach at least one target to a task.
- [ ] Jim can update task status.
- [ ] Jim can set due date and scheduled start.
- [ ] Jim can add and complete steps.
- [ ] Jim can add comments.
- [ ] Task logs capture important task events.
- [ ] Waiting approval tasks are visually distinct.
- [ ] Blocked tasks are visually distinct.
- [ ] Overdue tasks are visually distinct.

## Agent-Safety Acceptance

- [ ] MVP has no automatic production execution.
- [ ] No UI action writes to Mercari, Rakuten, Amazon, Baserow, or other production systems.
- [ ] `execution_brief` is stored but not executed automatically.
- [ ] Approval-required tasks cannot be treated as executable without human approval.
- [ ] Future agent execution state is represented as data, not active behavior.
- [ ] Logs are available for future execution attempts.

## Development Verification

- [ ] `npm install` succeeds.
- [ ] `npm run db:reset` succeeds after migration.
- [ ] Smoke query confirms seeded tasks load correctly.
- [ ] Type check succeeds.
- [ ] Frontend dev server starts if a frontend is added.
- [ ] Manual browser check confirms the four MVP pages render.

## Version Change Log

| Version | Date | Change |
|---|---|---|
| v0.2 | 2026-07-02 | Added locked owner, source, and loose target acceptance checks |
| v0.1 | 2026-07-02 | Initial acceptance checklist |
