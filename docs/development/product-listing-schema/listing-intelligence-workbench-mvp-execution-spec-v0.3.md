# Listing Intelligence Workbench MVP Execution Spec v0.3

Date: 2026-07-06
Status: Execution-ready spec for development review
Parent architecture: `listing-intelligence-workbench-mvp-design.md`

Database target safety: `listing-workbench-database-targets.md`

## Version Change Log

| Version | Date | Changes |
|---|---:|---|
| v0.3 | 2026-07-06 | Created execution-ready MVP phasing. Constrained first sprint to a no-Qwen Supabase workbench, fixed `listing_work_items` identity design, split workflow/issue/action concepts, clarified hero routing, deferred batch execution, and added source snapshot versioning. |

## Hard Rule

Build the workbench queue first.

Do not start with Qwen.

Do not implement the full Listing Intelligence capability in one pass.

The first shippable target is MVP-0:

```text
Supabase product/listing data
  -> deterministic target classification
  -> listing_work_items
  -> /listing workbench
  -> operator status update / task creation
```

Qwen, hero strategy generation, and batch execution must be designed for but not implemented in MVP-0.

## MVP Phasing

### MVP-0: No-Qwen Workbench

Goal:

Show operators the real listing work queue generated from Supabase data.

Includes:

- `listing_target_classification_v1`
- `listing_work_items`
- deterministic classification job
- `/listing` workbench
- filters
- work item status updates
- task creation from work item
- deterministic findings only

Excludes:

- Qwen adapter
- prompt profiles
- `listing_qwen_reviews`
- `listing_batches`
- `listing_batch_items`
- hero strategy generation
- marketplace publishing
- CSV export generation

Acceptance:

Operator can open `/listing` and see real Rakuten, Amazon, Mercari, and hero-related work items generated from Supabase.

### MVP-1: Qwen Review For Rakuten / Amazon

Goal:

Add local reasoning only after work items are visible and actionable.

Includes:

- Ollama adapter
- local Qwen model configuration
- `listing_intelligence_runs`
- `listing_intelligence_results`
- `listing_qwen_reviews`
- JSON schema validation
- source-fact validation
- repair attempts
- Rakuten audit prompt
- Amazon mapping audit prompt

Rules:

- unresolved mapping work items do not go to Qwen
- Qwen output must pass validation before it becomes operator-ready
- work item approval remains at work-item level

### MVP-2: Hero Strategy

Goal:

Let hero products enter a human-brief listing strategy workflow.

Includes:

- hero brief form
- hero strategy output
- missing-data checklist
- task recommendations
- platform-specific strategy draft

### MVP-3: Batch Preparation

Goal:

Support batch listing generation and CSV/export preparation.

Includes:

- `listing_batches`
- `listing_batch_items`
- batch brief
- batch item exception review
- export readiness status

MVP-0 may include an `Add to future batch` action, but it must not implement batch execution.

## Sprint Plan

### Sprint 1: Workbench Without Qwen

Deliver:

1. `listing_target_classification_v1`
2. `listing_work_items`
3. classification job
4. `/listing` workbench page
5. filters
6. task creation
7. work item status update

Acceptance:

- operator sees real work items from imported Supabase data
- Rakuten, Amazon, Mercari, and hero-related targets appear where applicable
- operator can filter by platform, workflow type, issue type, hero status, mapping status, and status
- operator can ignore, mark waiting input, or create task
- no Qwen code is required

### Sprint 2: Deterministic Validators

Deliver validators for:

- missing mapping
- missing SKU row
- active listing with no stock
- missing image
- unknown status
- missing price
- hero listing missing platform coverage
- title too short
- title missing core fields where source data provides those fields

Acceptance:

- validator findings appear on work items
- findings are stored in `source_context` or deterministic result payload
- high-value problems are visible without Qwen

### Sprint 3: Qwen Review

Deliver:

- Ollama adapter
- local Qwen prompt profile
- JSON schema
- source-fact validation
- repair loop
- `listing_qwen_reviews`

Acceptance:

- operator can run Qwen review for selected Rakuten/Amazon work items
- invalid Qwen output is marked invalid or repaired
- validated output is visible in the workbench detail view

### Sprint 4: Hero Strategy

Deliver:

- hero brief form
- strategy output contract
- missing-data checklist
- task recommendation creation

## Corrected Work Item Model

Do not use a nullable multi-column unique constraint as the primary dedupe rule.

PostgreSQL treats `NULL` values as distinct for ordinary unique constraints, so this pattern can still allow duplicate work items:

```sql
unique(work_type, platform, shop_code, product_family_id, product_spu_id, variant_id, bundle_id, listing_id, listing_sku_id)
```

Use `target_type`, `target_id`, and `target_key`.

Also split workflow, issue, and action:

- `workflow_type`: the workflow this item belongs to
- `issue_type`: the issue detected, if any
- `recommended_action`: the operator/system action recommended

Example:

```text
workflow_type = audit_existing_listing
issue_type = missing_images
recommended_action = create_image_task
```

## `listing_work_items` SQL Skeleton

```sql
create table if not exists listing_work_items (
  id uuid primary key default gen_random_uuid(),

  workflow_type text not null,
  issue_type text,
  recommended_action text,

  target_type text not null,
  target_id uuid not null,
  target_key text generated always as (
    workflow_type || ':' ||
    coalesce(platform, '') || ':' ||
    coalesce(shop_code, '') || ':' ||
    target_type || ':' ||
    target_id::text
  ) stored,

  platform text,
  shop_code text,
  product_family_id uuid references product_families(id) on delete set null,
  product_spu_id uuid references product_spus(id) on delete set null,
  variant_id uuid references product_variants(id) on delete set null,
  bundle_id uuid references bundle_products(id) on delete set null,
  listing_id uuid references platform_listings(id) on delete set null,
  listing_sku_id uuid references platform_listing_skus(id) on delete set null,

  priority_score numeric not null default 0,
  business_priority text not null default 'normal',
  issue_severity text not null default 'medium',

  is_hero boolean not null default false,
  hero_scope text,
  hero_priority integer,
  hero_reason text,
  target_platforms text[] default array[]::text[],
  listing_strategy_status text,

  human_input_level text not null default 'confirm_only',
  status text not null default 'open',
  assigned_to text,

  source_context jsonb not null default '{}'::jsonb,
  source_snapshot_hash text,
  source_snapshot_version integer not null default 1,
  classification_reasons jsonb not null default '[]'::jsonb,
  deterministic_findings jsonb not null default '[]'::jsonb,
  latest_result_id uuid,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  unique(target_key),
  check (workflow_type in (
    'audit_existing_listing',
    'optimize_hero_listing',
    'prepare_batch_listing',
    'review_batch_listing'
  )),
  check (issue_type is null or issue_type in (
    'missing_mapping',
    'missing_sku_row',
    'missing_images',
    'unknown_status',
    'price_missing',
    'price_stock_mismatch',
    'title_quality',
    'content_gap',
    'hero_platform_gap',
    'manual_review'
  )),
  check (recommended_action is null or recommended_action in (
    'ignore',
    'create_task',
    'run_qwen_review',
    'create_image_task',
    'create_mapping_task',
    'create_price_task',
    'request_human_brief',
    'add_to_future_batch'
  )),
  check (target_type in (
    'product_family',
    'product_spu',
    'variant',
    'bundle',
    'listing',
    'listing_sku'
  )),
  check (business_priority in ('low', 'normal', 'high', 'critical')),
  check (issue_severity in ('low', 'medium', 'high', 'critical')),
  check (hero_scope is null or hero_scope in ('product_family', 'product_spu', 'variant', 'bundle')),
  check (human_input_level in ('none', 'confirm_only', 'brief_required', 'batch_brief_required', 'expert_review_required')),
  check (status in ('open', 'in_progress', 'waiting_for_input', 'ready_for_review', 'approved', 'ignored', 'task_created', 'closed', 'stale'))
);
```

## Target Classification View

Create `listing_target_classification_v1` as the deterministic source for work item generation.

Recommended fields:

```text
target_type
target_id
workflow_type
issue_type
recommended_action
platform
shop_code
product_family_id
product_spu_id
variant_id
bundle_id
listing_id
listing_sku_id
is_hero
hero_scope
hero_priority
hero_reason
target_platforms
listing_strategy_status
business_priority
issue_severity
mapping_status
listing_status
stock_status
image_status
content_status
price_status
human_input_level
source_context
source_snapshot_hash
classification_reasons
priority_score
```

MVP-0 classification should generate work items for:

- Rakuten active listings with deterministic content/image/status/mapping problems
- Amazon active offers with mapping, ASIN, price, stock, or status problems
- Mercari listings with mapping/image/status problems
- hero SPUs from `merchandising_focus_items`
- hero platform coverage gaps

## Hero Routing Rule

Hero Product should produce two classes of work items.

### A. Always-On Strategic Work Item

```text
workflow_type = optimize_hero_listing
target_type = product_spu
target_id = product_spus.id
human_input_level = brief_required
business_priority = high
is_hero = true
```

This work item asks for human strategy input before Qwen or listing generation.

### B. Platform-Specific Execution Work Item

```text
workflow_type = audit_existing_listing
target_type = listing_sku or listing
platform = rakuten / amazon / mercari
priority_score boosted by hero_priority
```

This work item handles the marketplace-specific listing or offer. Hero status increases priority but does not replace platform-specific audit.

## Source Snapshot Version Strategy

Every work item and Qwen/result row must carry snapshot identity.

Required fields:

```text
source_snapshot_hash text
source_snapshot_version integer
```

Rules:

- generate `source_snapshot_hash` from stable JSON of the source context
- if the hash has not changed, do not rerun Qwen by default
- if the hash changes, mark prior result as `stale`
- increment `source_snapshot_version` when the work item source context materially changes
- include the hash in `listing_intelligence_results` and `listing_qwen_reviews` in MVP-1

## MVP-0 UI

Keep the first UI simple.

### List

Show work items.

Filters:

- platform
- shop
- workflow type
- issue type
- status
- hero only
- mapping status
- human input level
- priority
- search by title, item code, seller SKU, ASIN, listing ID

### Detail Drawer

Show:

- why this work item exists
- source context
- Product Family / SPU / Variant / Listing SKU trace
- deterministic findings
- latest result, if any
- source snapshot hash/version

### Action Bar

MVP-0 actions only:

- Ignore
- Create Task
- Mark Waiting Input
- Run Qwen Review

`Run Qwen Review` can be shown disabled until MVP-1 is implemented.

## Task Creation

MVP-0 must support creating a task from a work item.

Task target payload should include:

```text
work_item_id
workflow_type
issue_type
recommended_action
platform
shop_code
product_family_id
product_spu_id
variant_id
bundle_id
listing_id
listing_sku_id
source_snapshot_hash
```

Recommended task type mapping:

| Issue / recommended action | Task type |
|---|---|
| `missing_mapping` / `create_mapping_task` | `product_mapping_review` |
| `missing_images` / `create_image_task` | `listing_image_update` |
| `price_missing` / `create_price_task` | `pricing_review` |
| `price_stock_mismatch` / `create_price_task` | `pricing_review` |
| `content_gap` / `create_task` | `listing_content_update` |
| `title_quality` / `create_task` | `listing_content_update` |
| `hero_platform_gap` / `request_human_brief` | `hero_listing_strategy` |
| `manual_review` / `create_task` | `listing_manual_review` |

## Deferred But Designed

### Qwen

Do not implement in MVP-0.

When implemented in MVP-1:

- use Ollama only for MVP runtime
- create an adapter interface such as `LocalLLMProvider`
- default to current stable local Qwen model, such as `qwen3.5:9b` if available and reliable
- do not optimize model selection before the workflow works

### Batch

Do not implement `listing_batches` or `listing_batch_items` in first sprint.

MVP-0 may store `recommended_action = add_to_future_batch`.

Actual batch execution belongs to MVP-3.

### Hero Strategy

MVP-0 creates hero work items.

MVP-2 implements hero brief and strategy generation.

Required hero brief fields for MVP-2:

- target SPU / family
- target platform
- buyer persona
- main use case
- selling angle
- must-include facts
- do-not-claim facts
- price positioning
- competitor reference, optional
- image direction

## Open Decisions Resolved For MVP

1. Which local Qwen model first?

   Use the current stable local model first, such as `qwen3.5:9b` if available and reliable. Do not optimize model selection before the workflow works.

2. Only Ollama runtime?

   MVP: yes, Ollama only. Create an adapter interface like `LocalLLMProvider` so future runtimes can be added later.

3. Ship read-only workbench before Qwen?

   Yes. Build the workbench queue first.

4. Unresolved listings before Qwen?

   Yes. If mapping is unresolved, create deterministic `missing_mapping` / `create_mapping_task` work item first. Do not send unresolved mapping items to Qwen.

5. Approval level?

   MVP: approve at work-item level. Later: per recommendation item.

6. Rakuten fields for first prompt profile?

   Start with title, catch copy, description, search tags, image count / image plan, variant clarity, and forbidden claims.

7. Hero brief template?

   Use the required fields listed in the Hero Strategy deferred section.

## Non-Goals For Sprint 1

- Qwen adapter
- prompt profiles
- Qwen JSON validation
- Qwen repair loop
- hero strategy generation
- batch generation
- CSV export generation
- marketplace publishing
- direct Mercari/Rakuten/Amazon mutation

## Final Sprint 1 Acceptance Criteria

Sprint 1 is done when:

- `listing_target_classification_v1` exists and returns deterministic target rows
- `listing_work_items` exists with `target_key` uniqueness
- classification job upserts work items idempotently
- `/listing` reads work items from Supabase
- operator can filter work items
- operator can view work item detail with source context and deterministic findings
- operator can change status
- operator can create a task from a work item
- Qwen-related UI actions are disabled or absent
- no marketplace data is mutated
