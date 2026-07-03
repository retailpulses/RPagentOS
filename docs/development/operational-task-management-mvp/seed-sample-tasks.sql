-- Draft seed data for Operational Task Management MVP
-- Status: review only; do not apply until approved.

with inserted_tasks as (
  insert into tasks (
    title,
    description,
    task_type,
    status,
    priority,
    platform,
    shop_code,
    owner_type,
    owner_key,
    due_date,
    scheduled_start_at,
    completed_at,
    source,
    approval_required,
    execution_brief,
    created_by,
    approved_at,
    approved_by,
    agent_execution_status,
    metadata
  )
  values
    (
      'Fix product title for N508P301428A',
      'Clean up product naming before listing refresh.',
      'product',
      'in_progress',
      'high',
      'mercari',
      'shop4',
      'human',
      'jim',
      current_date,
      now(),
      null,
      'manual',
      false,
      null,
      'jim',
      null,
      null,
      null,
      '{"sample_key":"product_title_fix"}'::jsonb
    ),
    (
      'Approve Rakuten coupon campaign',
      'Review discount scope before any future campaign execution.',
      'promotion',
      'waiting_approval',
      'urgent',
      'rakuten',
      'main',
      'mixed',
      'jim',
      current_date,
      now(),
      null,
      'workflow',
      true,
      'Future agent should only prepare coupon targets after Jim approves the campaign scope.',
      'system',
      null,
      null,
      'approval_required',
      '{"sample_key":"rakuten_coupon_approval"}'::jsonb
    ),
    (
      'Draft Mercari listing improvement plan',
      'Prepare title and description improvement candidates for review.',
      'listing',
      'planned',
      'medium',
      'mercari',
      'shop4',
      'agent',
      'agent_listing',
      current_date + 2,
      now() + interval '1 day',
      null,
      'agent',
      false,
      'Agent may draft copy only. Human review is still required before platform update.',
      'agent',
      null,
      null,
      'not_ready',
      '{"sample_key":"mercari_listing_plan"}'::jsonb
    ),
    (
      'Resolve Amazon account tax document blocker',
      'Account-side issue blocks some operations until required document state is checked.',
      'account',
      'blocked',
      'low',
      'amazon',
      'jp',
      'human',
      'jim',
      current_date + 7,
      null,
      null,
      'manual',
      false,
      null,
      'jim',
      null,
      null,
      null,
      '{"sample_key":"amazon_account_blocker"}'::jsonb
    ),
    (
      'Prepare seasonal Mercari timesale workflow',
      'Backlog workflow for future approval-gated timesale preparation.',
      'workflow',
      'backlog',
      'medium',
      'mercari',
      'shop4',
      'agent',
      'agent_promotion',
      current_date + 14,
      null,
      null,
      'workflow',
      true,
      'Future agent can collect candidate listings but must not register a timesale without approval.',
      'system',
      null,
      null,
      'approval_required',
      '{"sample_key":"seasonal_timesale_workflow"}'::jsonb
    ),
    (
      'Record completed Mercari price review',
      'Sample completed task showing done state and completion timestamp.',
      'listing',
      'done',
      'high',
      'mercari',
      'shop4',
      'human',
      'jim',
      current_date - 1,
      now() - interval '2 days',
      now() - interval '1 day',
      'manual',
      false,
      null,
      'jim',
      null,
      null,
      'succeeded',
      '{"sample_key":"completed_price_review"}'::jsonb
    ),
    (
      'Cancel low-priority Rakuten promotion idea',
      'Sample canceled task for board column coverage.',
      'promotion',
      'canceled',
      'low',
      'rakuten',
      'main',
      'agent',
      'agent_promotion',
      current_date + 10,
      null,
      null,
      'agent',
      false,
      null,
      'agent',
      null,
      null,
      'canceled',
      '{"sample_key":"canceled_rakuten_promo"}'::jsonb
    )
  returning id, metadata
),
inserted_targets as (
  insert into task_targets (
    task_id,
    target_type,
    target_id,
    target_label,
    target_ref_json
  )
  select
    id,
    case metadata->>'sample_key'
      when 'product_title_fix' then 'variant'
      when 'rakuten_coupon_approval' then 'promotion_campaign'
      when 'mercari_listing_plan' then 'listing'
      when 'amazon_account_blocker' then 'account'
      when 'seasonal_timesale_workflow' then 'workflow'
      when 'completed_price_review' then 'listing'
      else 'promotion_campaign'
    end,
    case metadata->>'sample_key'
      when 'product_title_fix' then 'N508P301428A'
      when 'rakuten_coupon_approval' then 'rakuten-coupon-draft-001'
      when 'mercari_listing_plan' then 'mercari-shop4-listing-sample-001'
      when 'amazon_account_blocker' then 'amazon-jp-account'
      when 'seasonal_timesale_workflow' then 'mercari-timesale-prep'
      when 'completed_price_review' then 'mercari-shop4-listing-sample-002'
      else 'rakuten-promo-canceled-001'
    end,
    case metadata->>'sample_key'
      when 'product_title_fix' then 'SKU N508P301428A'
      when 'rakuten_coupon_approval' then 'Rakuten coupon draft'
      when 'mercari_listing_plan' then 'Mercari Shop4 sample listing'
      when 'amazon_account_blocker' then 'Amazon JP account'
      when 'seasonal_timesale_workflow' then 'Mercari seasonal timesale workflow'
      when 'completed_price_review' then 'Completed Mercari price review listing'
      else 'Canceled Rakuten promotion idea'
    end,
    jsonb_build_object('sample', true, 'key', metadata->>'sample_key')
  from inserted_tasks
  returning task_id
),
inserted_steps as (
  insert into task_steps (
    task_id,
    position,
    title,
    status,
    owner_type,
    owner_key
  )
  select id, 1, 'Review current business context', 'done', 'human', 'jim'
  from inserted_tasks
  union all
  select id, 2, 'Prepare next action', case when metadata->>'sample_key' = 'amazon_account_blocker' then 'blocked' else 'todo' end, owner_type, owner_key
  from tasks
  where id in (select id from inserted_tasks)
  returning task_id
),
inserted_comments as (
  insert into task_comments (
    task_id,
    body,
    author_type,
    author_key
  )
  select
    id,
    'Sample task comment for MVP UI validation.',
    'human',
    'jim'
  from inserted_tasks
  returning task_id
)
insert into task_logs (
  task_id,
  log_type,
  actor_type,
  actor_key,
  message,
  payload
)
select
  id,
  'task_seeded',
  'system',
  'system',
  'Sample task seeded for Operational Task Management MVP.',
  jsonb_build_object('sample', true, 'key', metadata->>'sample_key')
from inserted_tasks;
