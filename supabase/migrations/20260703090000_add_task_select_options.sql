-- Operational Task Management: runtime-configurable selector options.

create table if not exists task_select_options (
  id uuid primary key default gen_random_uuid(),
  field_key text not null,
  option_key text not null,
  label text not null,
  description text,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_select_options_field_key_check check (
    field_key in (
      'task_type',
      'priority',
      'owner_type',
      'owner_key',
      'source',
      'platform',
      'shop_code',
      'target_type'
    )
  ),
  constraint task_select_options_option_key_format_check check (
    option_key ~ '^[a-z][a-z0-9_:-]*$'
  ),
  constraint task_select_options_unique_option unique (field_key, option_key)
);

drop trigger if exists set_task_select_options_updated_at on task_select_options;
create trigger set_task_select_options_updated_at
before update on task_select_options
for each row execute function set_updated_at();

create index if not exists idx_task_select_options_field_active
  on task_select_options(field_key, is_active, sort_order);

insert into task_select_options (field_key, option_key, label, sort_order)
values
  ('task_type', 'product', 'Product', 10),
  ('task_type', 'promotion', 'Promotion', 20),
  ('task_type', 'listing', 'Listing', 30),
  ('task_type', 'account', 'Account', 40),
  ('task_type', 'workflow', 'Workflow', 50),
  ('task_type', 'image_generation', 'Image Generation', 60),
  ('priority', 'urgent', 'Urgent', 10),
  ('priority', 'high', 'High', 20),
  ('priority', 'medium', 'Medium', 30),
  ('priority', 'low', 'Low', 40),
  ('owner_type', 'human', 'Human', 10),
  ('owner_type', 'agent', 'Agent', 20),
  ('owner_type', 'mixed', 'Mixed', 30),
  ('owner_key', 'jim', 'Jim', 10),
  ('owner_key', 'agent_listing', 'Listing Agent', 20),
  ('owner_key', 'agent_promotion', 'Promotion Agent', 30),
  ('owner_key', 'external_operator', 'External Operator', 40),
  ('source', 'manual', 'Manual', 10),
  ('source', 'system', 'System', 20),
  ('source', 'agent', 'Agent', 30),
  ('source', 'import', 'Import', 40),
  ('source', 'workflow', 'Workflow', 50),
  ('source', 'external', 'External', 60),
  ('platform', 'mercari', 'Mercari', 10),
  ('platform', 'rakuten', 'Rakuten', 20),
  ('platform', 'amazon', 'Amazon', 30),
  ('shop_code', 'shop4', 'Shop4', 10),
  ('shop_code', 'main', 'Main', 20),
  ('shop_code', 'jp', 'Japan', 30)
on conflict (field_key, option_key) do update
set
  label = excluded.label,
  sort_order = excluded.sort_order,
  is_active = true,
  updated_at = now();

-- Configurable fields keep clean machine keys but no longer require a migration
-- for every new business option.
alter table tasks drop constraint if exists tasks_task_type_check;
alter table tasks drop constraint if exists tasks_priority_check;
alter table tasks drop constraint if exists tasks_owner_key_check;
alter table tasks drop constraint if exists tasks_source_check;
alter table task_steps drop constraint if exists task_steps_owner_key_check;

alter table tasks
  add constraint tasks_task_type_key_format_check
  check (task_type ~ '^[a-z][a-z0-9_:-]*$');

alter table tasks
  add constraint tasks_priority_key_format_check
  check (priority ~ '^[a-z][a-z0-9_:-]*$');

alter table tasks
  add constraint tasks_owner_key_format_check
  check (owner_key is null or owner_key ~ '^[a-z][a-z0-9_:-]*$');

alter table tasks
  add constraint tasks_source_key_format_check
  check (source ~ '^[a-z][a-z0-9_:-]*$');

alter table task_steps
  add constraint task_steps_owner_key_format_check
  check (owner_key is null or owner_key ~ '^[a-z][a-z0-9_:-]*$');

grant all on task_select_options to service_role;
grant select, insert, update, delete on task_select_options to anon, authenticated;
