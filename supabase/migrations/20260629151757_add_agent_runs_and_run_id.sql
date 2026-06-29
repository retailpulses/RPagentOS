-- Agent OS Core: add agent_runs table and run_id to related tables

-- ── agent_runs ────────────────────────────────────────
create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  run_type text not null,
  target_platform text,
  target_shop_code text,
  status text not null default 'running',
  started_at timestamptz default now(),
  finished_at timestamptz,
  metadata jsonb
);

-- ── run_id on promotion_candidates ────────────────────
alter table promotion_candidates
  add column if not exists run_id uuid references agent_runs(id) on delete set null;

-- ── run_id on agent_decisions ─────────────────────────
alter table agent_decisions
  add column if not exists run_id uuid references agent_runs(id) on delete set null;

-- ── run_id on human_approvals ─────────────────────────
alter table human_approvals
  add column if not exists run_id uuid references agent_runs(id) on delete set null;

-- ── run_id on agent_execution_logs ────────────────────
alter table agent_execution_logs
  add column if not exists run_id uuid references agent_runs(id) on delete set null;

-- ── indexes ───────────────────────────────────────────
create index if not exists idx_agent_runs_status
  on agent_runs(status);
create index if not exists idx_promotion_candidates_run_id
  on promotion_candidates(run_id);
create index if not exists idx_agent_decisions_run_id
  on agent_decisions(run_id);
create index if not exists idx_human_approvals_run_id
  on human_approvals(run_id);
create index if not exists idx_agent_execution_logs_run_id
  on agent_execution_logs(run_id);

-- ── permissions ───────────────────────────────────────
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
