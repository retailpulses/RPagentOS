# Project Management MVP Design

Version: v0.1 draft
Date: 2026-07-07
Status: design review — do not implement until approved

## Objective

Add a lightweight project layer above the existing operational task management system. Operators can create projects, group tasks under them, and maintain project-level descriptions and attachments.

This is **not** a full project management suite. It is a thin grouping layer — the existing task system does the heavy lifting for steps, comments, logs, targets, and execution tracking.

## Product Principle

A project is a **container for related operational tasks**. It provides:

- A name and description for the body of work.
- A single place to attach project-level files (briefs, screenshots, spreadsheets).
- A filtered view of all tasks belonging to that project.

Projects do **not** replace tasks — they organize them.

## MVP Scope

### In Scope

- Create, view, update, and list projects.
- Project detail page with editable description and file attachments.
- Link existing tasks to a project (`project_id` FK on `tasks`).
- Filter the task board and today views by project.
- Create a new task from within a project (pre-filled project context).
- Project list page with basic status filtering.

### Out of Scope

- Project milestones, deadlines, or Gantt charts.
- Project-level steps, comments, or logs (those live on tasks).
- Project templates.
- Project portfolios or folders.
- Project team/assignee management beyond the existing `owner_type`/`owner_key` on tasks.
- Project-level agent execution or approval workflows.

## Data Model

### New Table: `projects`

```sql
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_status_check check (
    status in ('active', 'paused', 'completed', 'archived')
  )
);

-- Trigger for updated_at
create trigger set_projects_updated_at
  before update on projects
  for each row execute function set_updated_at();

create index if not exists idx_projects_status on projects(status);
```

### New Table: `project_attachments`

Same pattern as `task_attachments` but scoped to projects:

```sql
create table if not exists project_attachments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  file_name text not null,
  content_type text not null,
  file_size_bytes integer not null,
  file_data_url text not null,
  uploaded_by text not null default 'jim',
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint project_attachments_uploaded_by_check check (
    uploaded_by in ('jim', 'system', 'agent')
  ),
  constraint project_attachments_file_size_check check (
    file_size_bytes > 0 and file_size_bytes <= 5242880
  )
);

create index if not exists idx_project_attachments_project_created
  on project_attachments(project_id, created_at);
```

### Alter Existing Table: `tasks`

Add a nullable FK to projects:

```sql
alter table tasks
  add column if not exists project_id uuid
  references projects(id) on delete set null;

create index if not exists idx_tasks_project_id on tasks(project_id);
```

This is a **soft link** — deleting a project does not delete its tasks; it just clears the `project_id`. Tasks can also exist without a project (backward compatible).

### Project Statuses

| Status | Meaning |
|--------|---------|
| `active` | Work is ongoing. Default for new projects. |
| `paused` | Temporarily on hold. Tasks remain but the project is not in active rotation. |
| `completed` | All work done. Project is read-only in spirit. |
| `archived` | Hidden from default views. Preserved for history. |

## Routes

Add to the existing React Router routes in `App.tsx`:

| Route | Page | Purpose |
|-------|------|---------|
| `/projects` | ProjectList | List all projects with status filter |
| `/projects/:id` | ProjectDetail | Project description, attachments, and filtered task list |
| `/projects/new` | CreateProject | Simple create form |

Existing routes that need project-awareness:

| Route | Change |
|-------|--------|
| `/task/new` (CreateTask) | Add optional project selector |
| `/tasks/:id` (TaskDetail) | Show linked project with link |
| `/board` (Board) | Add project filter |
| `/today` (Today) | Add project filter |

## Page Requirements

### Project List (`/projects`)

- Grid or list of projects, grouped/filtered by status.
- Each card shows: name, status badge, task count, updated_at.
- "New Project" button opens create form or navigates to `/projects/new`.
- Clicking a project opens `/projects/:id`.

### Create Project (`/projects/new`)

Simple form:
- **name** (required) — text input.
- **description** (optional) — textarea.
- **status** — defaults to `active`.

On create, redirect to the new project's detail page.

### Project Detail (`/projects/:id`)

Sections:

1. **Header**: project name, status badge, status change buttons, edit button.
2. **Description**: rendered as pre-wrap text. Editable inline or via edit mode toggle (same pattern as TaskDetail).
3. **Attachments**: file upload + list, same pattern as TaskDetail attachments. Supports image, CSV, PDF, text. 5 MB limit.
4. **Tasks**: filtered list of tasks belonging to this project. Each task renders as a compact card (reuse `TaskCard`). "Add Task" button navigates to `/task/new?project_id=<id>`.

### Changes to Create Task (`/task/new`)

- Add an optional "Project" dropdown/selector populated from the `projects` table.
- If navigated from a project detail page (`?project_id=<id>`), pre-select that project.

### Changes to Task Detail (`/tasks/:id`)

- If the task has a `project_id`, show a linked project name that navigates to `/projects/:id`.

### Changes to Board / Today

- Add a project filter dropdown (optional — filters tasks by `project_id`).

## File Structure

New and modified files:

```text
apps/web/src/
  pages/
    ProjectList.tsx      (new)
    ProjectDetail.tsx    (new)
    CreateProject.tsx    (new — could also be a modal on ProjectList)
  components/
    ProjectCard.tsx      (new)
    ProjectAttachments.tsx (new — or reuse TaskAttachments with generic props)
    Layout.tsx           (modified — add nav link to /projects)
  hooks/
    useProjects.ts       (new — CRUD for projects and project attachments)
  App.tsx                (modified — add /projects routes)

src/lib/
  project-types.ts       (new — ProjectRow, ProjectAttachmentRow, etc.)
  projects.ts            (new — service functions for projects)

supabase/migrations/
  <timestamp>_add_projects.sql  (new)
```

## Service / API Surface

Functions in `src/lib/projects.ts`:

```typescript
listProjects(filters?: { status?: string }): Promise<ProjectRow[]>
getProjectDetail(id: string): Promise<ProjectDetailRow>  // project + attachments + tasks
createProject(input: CreateProjectInput): Promise<ProjectRow>
updateProject(id: string, input: UpdateProjectInput): Promise<ProjectRow>
addProjectAttachment(projectId: string, input: CreateAttachmentInput): Promise<ProjectAttachmentRow>
removeProjectAttachment(attachmentId: string): Promise<void>
```

React hooks in `apps/web/src/hooks/useProjects.ts` following the existing `useTasks.ts` pattern:

```typescript
useProjectList(filters?)
useProjectDetail(id)
useCreateProject()
useUpdateProject()
useAddProjectAttachment()
useRemoveProjectAttachment()
```

## Backward Compatibility

- `project_id` on tasks is nullable. All existing tasks get `NULL` — no migration of existing data needed.
- All existing pages and hooks work unchanged.
- The task board and today views work identically when no project filter is active.

## UI Safety Rules

- Same rules as the task management MVP: no production execution controls, no marketplace writes.
- Project attachments follow the same 5 MB size limit and accepted file types as task attachments.
- No auth/RLS changes — follow the existing MVP posture (anon key access for local use).

## Implementation Phases

### Phase 1: Database
- Create migration with `projects` and `project_attachments` tables.
- Alter `tasks` to add `project_id`.
- Run migration and smoke-test.

### Phase 2: Services & Types
- Add `src/lib/project-types.ts`.
- Add `src/lib/projects.ts` service functions.
- Add `apps/web/src/hooks/useProjects.ts`.

### Phase 3: Project Pages
- Add `ProjectList`, `ProjectDetail`, `CreateProject` pages.
- Add `ProjectCard` and `ProjectAttachments` components.
- Add routes to `App.tsx` and nav link to `Layout.tsx`.

### Phase 4: Task Integration
- Add project selector to CreateTask.
- Show linked project in TaskDetail.
- Add project filter to Board and Today views.

### Phase 5: QA & Polish
- Smoke-test full flow: create project → add tasks → view project detail → upload attachments.
- Verify backward compatibility: existing tasks and views still work.
- Verify no production write paths exist.

## Open Questions for Review

1. **Project status lifecycle**: Are `active → paused → completed → archived` the right states? Should `archived` projects hide their tasks from the board by default?
2. **Attachment storage**: Continue with data URLs (same as tasks) or introduce Supabase Storage? Data URLs are simpler for MVP but won't scale past ~5 MB files.
3. **Project nesting**: Do we need sub-projects or is a flat list sufficient?
4. **Task ordering within project**: Should the project detail page allow drag-to-reorder tasks, or is the default sort (priority + due date) enough?

## Version Change Log

| Version | Date | Change |
|---------|------|--------|
| v0.1 | 2026-07-07 | Initial design from requirements |
