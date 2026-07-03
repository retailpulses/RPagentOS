-- Draft migration: add Operational Task Management MVP
-- Status: review only; do not apply until approved.

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  task_type text not null,
  status text not null default 'backlog',
  priority text not null default 'medium',
  platform text,
  shop_code text,
  owner_type text,
  owner_key text,
  due_date date,
  scheduled_start_at timestamptz,
  completed_at timestamptz,
  source text not null default 'manual',
  approval_required boolean not null default false,
  execution_brief text,
  created_by text not null default 'jim',
  approved_at timestamptz,
  approved_by text,
  agent_run_id uuid references agent_runs(id) on delete set null,
  agent_execution_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_task_type_check check (
    task_type in ('product', 'promotion', 'listing', 'account', 'workflow')
  ),
  constraint tasks_status_check check (
    status in ('backlog', 'planned', 'in_progress', 'waiting_approval', 'blocked', 'done', 'canceled')
  ),
  constraint tasks_priority_check check (
    priority in ('urgent', 'high', 'medium', 'low')
  ),
  constraint tasks_owner_type_check check (
    owner_type is null or owner_type in ('human', 'agent', 'mixed')
  ),
  constraint tasks_owner_key_check check (
    owner_key is null or owner_key in ('jim', 'agent_listing', 'agent_promotion', 'external_operator')
  ),
  constraint tasks_created_by_check check (
    created_by in ('jim', 'system', 'agent')
  ),
  constraint tasks_source_check check (
    source in ('manual', 'system', 'agent', 'import', 'workflow', 'external')
  ),
  constraint tasks_agent_execution_status_check check (
    agent_execution_status is null
    or agent_execution_status in (
      'not_ready',
      'approval_required',
      'approved',
      'queued',
      'running',
      'succeeded',
      'failed',
      'canceled'
    )
  ),
  constraint tasks_completed_status_check check (
    (status = 'done' and completed_at is not null)
    or status <> 'done'
  )
);

create table if not exists task_targets (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  target_type text not null,
  target_id text,
  target_label text,
  target_ref_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint task_targets_reference_check check (
    target_id is not null
    or target_label is not null
    or target_ref_json <> '{}'::jsonb
  )
);

create table if not exists task_steps (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  position integer not null default 0,
  title text not null,
  description text,
  status text not null default 'todo',
  owner_type text,
  owner_key text,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_steps_status_check check (
    status in ('todo', 'in_progress', 'blocked', 'done', 'skipped')
  ),
  constraint task_steps_owner_type_check check (
    owner_type is null or owner_type in ('human', 'agent', 'mixed')
  ),
  constraint task_steps_owner_key_check check (
    owner_key is null or owner_key in ('jim', 'agent_listing', 'agent_promotion', 'external_operator')
  )
);

create table if not exists task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  body text not null,
  author_type text,
  author_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_comments_author_type_check check (
    author_type is null or author_type in ('human', 'agent', 'system')
  )
);

create table if not exists task_logs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  step_id uuid references task_steps(id) on delete set null,
  run_id uuid references agent_runs(id) on delete set null,
  log_type text not null,
  actor_type text,
  actor_key text,
  message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint task_logs_actor_type_check check (
    actor_type is null or actor_type in ('human', 'agent', 'system')
  )
);

drop trigger if exists set_tasks_updated_at on tasks;
create trigger set_tasks_updated_at
before update on tasks
for each row execute function set_updated_at();

drop trigger if exists set_task_steps_updated_at on task_steps;
create trigger set_task_steps_updated_at
before update on task_steps
for each row execute function set_updated_at();

drop trigger if exists set_task_comments_updated_at on task_comments;
create trigger set_task_comments_updated_at
before update on task_comments
for each row execute function set_updated_at();

create index if not exists idx_tasks_status on tasks(status);
create index if not exists idx_tasks_priority on tasks(priority);
create index if not exists idx_tasks_type on tasks(task_type);
create index if not exists idx_tasks_platform_shop on tasks(platform, shop_code);
create index if not exists idx_tasks_owner on tasks(owner_type, owner_key);
create index if not exists idx_tasks_due_date on tasks(due_date);
create index if not exists idx_tasks_scheduled_start on tasks(scheduled_start_at);
create index if not exists idx_tasks_waiting_approval
  on tasks(status, approval_required)
  where status = 'waiting_approval' or approval_required = true;

create index if not exists idx_task_targets_task_id on task_targets(task_id);
create index if not exists idx_task_targets_target on task_targets(target_type, target_id);
create index if not exists idx_task_targets_ref_json on task_targets using gin(target_ref_json);
create index if not exists idx_task_steps_task_position on task_steps(task_id, position);
create index if not exists idx_task_comments_task_created on task_comments(task_id, created_at);
create index if not exists idx_task_logs_task_created on task_logs(task_id, created_at);
create index if not exists idx_task_logs_run_id on task_logs(run_id);

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
