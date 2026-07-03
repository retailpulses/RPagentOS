# Operational Task Management MVP Module Spec

Version: v0.2 draft
Date: 2026-07-02

## Objective

Build an MVP Operational Task Management module for RPagentOS.

The module lets Jim manage ecommerce operations tasks across shops, products, listings, promotions, accounts, and workflows. MVP behavior is manual-first, but the schema must be agent-ready and approval-gated for future automation.

## Product Principle

This is not a generic TODO app.

Operational tasks must be connected to business context:

- Which platform and shop is affected.
- Which product, SKU, listing, promotion, account, or workflow is targeted.
- What human decision or action is needed.
- What an agent may later execute, after approval.
- What happened before, during, and after the task.

## MVP Scope

### In Scope

- Create, view, update, and organize operational tasks.
- Link tasks to one or more business targets.
- Add ordered task steps.
- Add human comments.
- Record task logs for auditability.
- Show Today / This Week, Board, Detail, and Create Task pages.
- Store agent-ready fields without allowing automatic production execution.
- Keep all production-impacting actions approval-gated.

### Out of Scope

- Automatic production changes.
- Real Mercari, Rakuten, Amazon, or Baserow writes from task actions.
- Full permission system.
- Complex SLA engine.
- Agent worker execution queue.
- Notification system.
- Calendar sync.

## Task Types

Allowed MVP values:

- `product`
- `promotion`
- `listing`
- `account`
- `workflow`

## Statuses

Allowed MVP values:

- `backlog`
- `planned`
- `in_progress`
- `waiting_approval`
- `blocked`
- `done`
- `canceled`

Status intent:

| Status | Meaning |
|---|---|
| `backlog` | Captured but not scheduled |
| `planned` | Scheduled or selected for work |
| `in_progress` | Actively being worked |
| `waiting_approval` | Proposed action needs human approval |
| `blocked` | Cannot progress without external input or fix |
| `done` | Completed and no longer active |
| `canceled` | Intentionally stopped |

## Priorities

Allowed MVP values:

- `urgent`
- `high`
- `medium`
- `low`

## Core Tables

MVP tables:

- `tasks`
- `task_targets`
- `task_steps`
- `task_comments`
- `task_logs`

## Task Fields

`tasks` must include:

- `title`
- `description`
- `task_type`
- `status`
- `priority`
- `platform`
- `shop_code`
- `owner_type`
- `owner_key`
- `due_date`
- `scheduled_start_at`
- `completed_at`
- `source`
- `approval_required`
- `execution_brief`
- `created_by`
- `created_at`
- `updated_at`

Recommended agent-readiness fields:

- `approved_at`
- `approved_by`
- `agent_run_id`
- `agent_execution_status`
- `metadata`

These fields let the task become executable later without changing the core table.

## Related Targets

Tasks may target multiple business objects. Examples:

| Target Type | Example |
|---|---|
| `product` | SPU/product row |
| `variant` | SKU |
| `listing` | Platform listing |
| `promotion_candidate` | Existing promotion candidate |
| `promotion_campaign` | Future campaign entity |
| `account` | Shop/account object |
| `workflow` | Operational process |
| `external_record` | Baserow, CSV, or adapter-side record |

MVP target linking uses loose references because not every source object exists in Supabase yet.

Required `task_targets` fields:

- `task_id`
- `target_type`
- `target_id`
- `target_label`
- `target_ref_json`

`target_id` is intentionally loose and should be stored as text so it can hold a Supabase UUID, SKU, platform listing ID, Baserow row ID, workflow key, or future adapter reference.

## Pages

### Today / This Week View

Purpose: daily operator command center.

Show:

- Overdue tasks.
- Tasks due today.
- Tasks scheduled today.
- Tasks due this week.
- Tasks waiting approval.
- Blocked tasks.

Default sort:

1. Urgent/high priority.
2. Overdue first.
3. Scheduled start time.
4. Due date.

### Task Board

Purpose: status-based workflow view.

Columns:

- Backlog
- Planned
- In Progress
- Waiting Approval
- Blocked
- Done
- Canceled

Cards should be compact and scan-friendly.

### Task Detail

Purpose: single source of operational context.

Show:

- Business context.
- Related targets.
- Description.
- Execution brief.
- Steps.
- Comments.
- Logs.

Task detail must make approval state obvious when `approval_required=true`.

### Create Task

Purpose: fast manual task capture.

Required fields:

- `title`
- `task_type`
- `priority`

Useful optional fields:

- `description`
- `platform`
- `shop_code`
- `owner_type`
- `owner_key`
- `due_date`
- `scheduled_start_at`
- `source`
- `approval_required`
- `execution_brief`
- related targets
- initial steps

## Task Card Requirements

Each task card must show:

- `title`
- `task_type`
- `platform`
- `shop_code`
- `priority`
- `status`
- `due_date`
- `owner_type`
- related targets summary

Recommended card behavior:

- Use priority and overdue indicators.
- Keep target summary short, for example `2 listings, 1 SKU`.
- Do not show raw IDs unless there is no better label.

## Task Detail Requirements

Task detail must show:

- Business context.
- Related targets.
- Description.
- Execution brief.
- Steps.
- Comments.
- Logs.

Recommended sections:

- Header: title, status, priority, owner, dates.
- Context: platform, shop, task type, source.
- Targets: grouped target list.
- Execution: approval requirement, brief, future agent state.
- Work: steps with completion state.
- Activity: comments and logs.

## Agent and Approval Rules

MVP must not execute production changes automatically.

Rules:

- A task may describe a future agent action.
- A task may store `execution_brief`.
- A task may be marked `approval_required=true`.
- A task may enter `waiting_approval`.
- No UI control should trigger real marketplace or source-system writes in MVP.
- Future execution workers must only pick up tasks where approval state allows execution.
- All future execution attempts must write logs.

## API Surface

If building a frontend, minimum endpoints or server actions should support:

- List tasks with filters.
- Create task.
- Update task fields.
- Update status.
- Add/update steps.
- Add comment.
- Add task log.
- Link/unlink target.
- Read task detail with targets, steps, comments, and logs.

## Filters

MVP filters:

- `status`
- `priority`
- `task_type`
- `platform`
- `shop_code`
- `owner_type`
- `owner_key`
- due date range
- scheduled date range
- approval required

## Implementation Notes

- Use Supabase as the canonical RPagentOS operational store.
- Keep task tables separate from promotion-specific tables.
- Link to existing `platform_listings`, `promotion_candidates`, and `agent_runs` where useful.
- Keep target references flexible enough for Baserow and future source objects.
- Avoid a generic free-form-only model; structured fields are needed for filtering, board views, and future agent execution.

## Version Change Log

| Version | Date | Change |
|---|---|---|
| v0.2 | 2026-07-02 | Aligned owner and target fields with locked implementation decisions |
| v0.1 | 2026-07-02 | Initial module spec from user requirements |
