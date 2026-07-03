# Operational Task Management API / Service Design

Version: v0.1 draft
Date: 2026-07-02
Status: design only; do not implement until approved

## Approach

Use plain Supabase JS client functions. Do not add an ORM for the MVP.

Recommended files:

```text
src/lib/task-types.ts
src/lib/tasks.ts
```

## Types

```ts
export type TaskType = 'product' | 'promotion' | 'listing' | 'account' | 'workflow';
export type TaskStatus =
  | 'backlog'
  | 'planned'
  | 'in_progress'
  | 'waiting_approval'
  | 'blocked'
  | 'done'
  | 'canceled';
export type TaskPriority = 'urgent' | 'high' | 'medium' | 'low';
export type OwnerType = 'human' | 'agent' | 'mixed';
export type OwnerKey = 'jim' | 'agent_listing' | 'agent_promotion' | 'external_operator';
export type CreatedBy = 'jim' | 'system' | 'agent';
export type TaskSource = 'manual' | 'system' | 'agent' | 'import' | 'workflow' | 'external';
```

## Query Functions

```ts
export interface TaskFilters {
  status?: TaskStatus[];
  priority?: TaskPriority[];
  task_type?: TaskType[];
  platform?: string;
  shop_code?: string;
  owner_type?: OwnerType;
  owner_key?: OwnerKey;
  due_before?: string;
  due_after?: string;
  scheduled_after?: string;
  scheduled_before?: string;
  approval_required?: boolean;
  search?: string;
}

export async function listTasks(filters: TaskFilters): Promise<TaskCardRow[]>;
export async function getTaskDetail(id: string): Promise<TaskDetailRow>;
```

## Mutation Functions

```ts
export async function createTask(input: CreateTaskInput): Promise<TaskRow>;
export async function updateTask(id: string, input: UpdateTaskInput): Promise<TaskRow>;
export async function updateTaskStatus(id: string, status: TaskStatus): Promise<TaskRow>;
```

Status updates should write a `task_logs` row with `log_type='status_changed'`.

## Target Functions

```ts
export async function linkTarget(taskId: string, input: CreateTaskTargetInput): Promise<TaskTargetRow>;
export async function unlinkTarget(taskId: string, targetRowId: string): Promise<void>;
```

`target_id` is a text value. It may hold a UUID, SKU, Baserow row ID, platform listing ID, workflow key, or other external reference.

## Step Functions

```ts
export async function createStep(taskId: string, input: CreateTaskStepInput): Promise<TaskStepRow>;
export async function updateStep(stepId: string, input: UpdateTaskStepInput): Promise<TaskStepRow>;
```

Step completion should set `completed_at` when status becomes `done`.

## Comment Functions

```ts
export async function addComment(taskId: string, input: CreateTaskCommentInput): Promise<TaskCommentRow>;
```

Adding a comment may optionally write a `task_logs` row with `log_type='comment_added'`.

## Log Function

```ts
export async function addTaskLog(taskId: string, input: CreateTaskLogInput): Promise<TaskLogRow>;
```

## UI Data Shapes

Task cards should load:

- task core fields
- related target count
- related target summary labels

Task detail should load:

- task
- targets
- ordered steps
- comments by `created_at`
- logs by `created_at`

## Production Safety

The service layer must not call marketplace APIs or source-system write APIs. It only reads and writes RPagentOS Supabase task tables for MVP.

## Version Change Log

| Version | Date | Change |
|---|---|---|
| v0.1 | 2026-07-02 | Initial API and service design |
