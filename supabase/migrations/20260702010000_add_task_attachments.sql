-- Operational Task Management MVP: task attachments
-- Stores small operator-provided files directly as data URLs for the MVP.
-- This avoids introducing Supabase Storage bucket policy work before auth/RLS.

create table if not exists task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  file_name text not null,
  content_type text not null,
  file_size_bytes integer not null,
  file_data_url text not null,
  uploaded_by text not null default 'jim',
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint task_attachments_uploaded_by_check check (
    uploaded_by in ('jim', 'system', 'agent')
  ),
  constraint task_attachments_file_size_check check (
    file_size_bytes > 0 and file_size_bytes <= 5242880
  )
);

create index if not exists idx_task_attachments_task_created
  on task_attachments(task_id, created_at);

grant all on task_attachments to service_role;

-- MVP RLS decision follows the task tables: auth/RLS is deferred for the
-- local/manual MVP and must be replaced before production use.
grant select, insert, update, delete on task_attachments to anon, authenticated;
