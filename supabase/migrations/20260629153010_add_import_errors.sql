-- Agent OS Core: add import_errors table for listing import audit

create table if not exists import_errors (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references agent_runs(id) on delete set null,
  source_file text,
  row_index integer,
  raw_row jsonb,
  error_message text not null,
  created_at timestamptz default now()
);

create index if not exists idx_import_errors_run_id
  on import_errors(run_id);

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
