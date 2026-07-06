# RP AgentOS Listing Intelligence Workbench MVP

Date: 2026-07-06
Status: Draft for review
Scope: Listing Intelligence capability for RP AgentOS using the new product/listing Supabase schema and local Qwen reasoning

## Version Change Log

| Version | Date | Changes |
|---|---:|---|
| v0.1 | 2026-07-06 | Initial LLM-first listing audit design. |
| v0.2 | 2026-07-06 | Reframed from Listing Audit to Listing Intelligence Workbench. Added workflow routing, first-class work items, local Qwen validation loop, hero and batch workflows, and revised platform priorities. |
| v0.3 | 2026-07-06 | Added execution-ready MVP phasing in `listing-intelligence-workbench-mvp-execution-spec-v0.3.md`. First development target is MVP-0: Supabase-backed workbench without Qwen. |

## Important MVP Execution Clarification

Do not implement the full Listing Intelligence capability in one pass.

The first implementation target is MVP-0: Supabase-backed Listing Workbench without Qwen.

MVP-0 includes:

- `listing_target_classification_v1`
- `listing_work_items`
- deterministic classification job
- `/listing` workbench
- filters
- work item status updates
- task creation from work item

MVP-0 excludes:

- Qwen adapter
- prompt profiles
- `listing_qwen_reviews`
- `listing_batches`
- `listing_batch_items`
- hero strategy generation
- marketplace publishing
- CSV export generation

Design the database so Qwen, hero strategy, and batch workflow can be added later, but do not implement them in the first sprint.

For development handoff, use:

`docs/development/product-listing-schema/listing-intelligence-workbench-mvp-execution-spec-v0.3.md`

## Capability Definition

Use the capability name:

```text
Listing Intelligence
```

Do not position this as only a Listing Audit module.

Listing Audit is one workflow inside Listing Intelligence. The broader capability includes:

```text
Listing Intelligence
├─ Existing Listing Audit
├─ Hero Product Listing Strategy
├─ Batch Listing Generation
├─ Listing Rewrite / Optimization
├─ Image Requirement Planning
├─ Marketplace Field Validation
├─ SKU / ASIN / Variation Mapping
├─ CSV / API Publishing Preparation
└─ Operator Task Creation
```

This framing matches RP AgentOS better because the system should route listing work into the right workflow, not just send listings to one LLM reviewer.

## Job-Specific Definition of Done

The Listing Intelligence Workbench MVP is done when:

- operators can open `/listing` and see real Supabase-backed listing work items
- the workbench uses the corrected hierarchy: Product Family -> Product SPU -> Product Variant -> Platform Listing SKU -> Platform Listing
- target classification creates prioritized `listing_work_items`
- existing listing audit, hero product optimization, and batch listing preparation are represented as distinct workflow types
- local Qwen is used for reasoning, drafting, classification assist, SEO gap detection, and listing strategy where appropriate
- deterministic validators remain the authority for facts, prices, stock, dimensions, platform constraints, JSON shape, and unsupported claims
- every Qwen result stores provider/runtime/model, prompt profile, source snapshot, validation status, validation errors, repair attempts, and raw response
- operators can review, approve, ignore, regenerate, or create tasks from work items
- unresolved links, unknown statuses, missing images, and mapping conflicts become visible work items
- no marketplace listing is updated automatically in MVP

## Design Principles

1. Capability before agent.

   Listing Intelligence is a reusable commerce capability. It should not be designed as one "listing agent" or a single audit job.

2. Work item first.

   RP AgentOS should create operational work before running expensive reasoning. The queue of `listing_work_items` is the control surface for operators and automation.

3. Workflow-specific reasoning.

   Existing listing audit, hero product strategy, and batch listing preparation need different human input, prompts, validators, and outputs.

4. Local Qwen is the generator, not the authority.

   Qwen can classify, reason, draft, summarize, and propose. Supabase source data plus deterministic validators remain the source of truth.

5. Human input level must be explicit.

   Some workflows need only confirmation. Hero products and batch listing strategy need briefs. The system should not pretend all listing work can run fully unattended.

6. Product-platform mapping stays authoritative.

   Use `product_platform_links` for mapping internal products/SKUs to marketplace listings/SKUs. Convenience fields on `platform_listings` are not authoritative.

7. Separate analysis from execution.

   MVP may create tasks, draft listing content, prepare CSV/API payloads, and flag readiness. It must not publish or update marketplace listings automatically.

8. Design for operator trust.

   Every recommendation should show source evidence, validation status, and why the work item exists.

## Correct Product / Listing Hierarchy

The workbench should use this hierarchy:

```text
product_families
  has many product_spus

product_spus
  has many product_variants
  may be prioritized through merchandising_focus_items

product_variants
  maps to platform_listing_skus through product_platform_links

platform_listings
  has many platform_listing_skus
  has many platform_listing_images
  has many platform_listing_attributes
```

Target grain:

- `platform_listing_skus.id` for existing listing/offer work when SKU rows exist
- `platform_listings.id` for listing-level work when no SKU rows exist
- `product_spus.id` for hero product strategy
- `product_variants.id` for SKU-level listing preparation
- `bundle_products.id` later for bundle listing work

## Target Architecture

Replace the simple flow:

```text
Supabase listing data -> LLM audit -> audit result
```

with:

```text
Supabase product/listing data
  -> target classification
  -> listing_work_items
  -> workflow router
  -> platform-specific adapter
  -> workflow-specific local Qwen reasoning
  -> deterministic validation
  -> operator approval
  -> task / batch / export / future publish
```

## Workflow Types

### A. Existing Listing Audit

Purpose:

- audit imported Rakuten, Amazon, and Mercari listings/offers
- find operational and content issues
- prioritize fixes for existing marketplace records

Human input level:

- usually `confirm_only`
- `none` is acceptable for low-risk deterministic checks

Operator selects:

- platform
- shop
- status
- priority
- run audit

Output:

- issue list
- risk score
- mapping problems
- content problems
- image problems
- price/stock problems
- recommended action

Best for:

- Rakuten active listings
- Amazon offers and mapping correctness
- Mercari existing CSV-managed listings

### B. Hero Product Optimization

Purpose:

- create or improve listing strategy for prioritized SPUs, families, variants, or bundles
- produce platform-specific listing direction and improvement tasks

Human input level:

- `brief_required` or `expert_review_required`

Operator brief:

- hero SPU / product family / variant / bundle
- target platform
- main selling angle
- target buyer
- main use case
- must-include facts
- do-not-claim facts
- price positioning
- image direction
- competitor reference, optional

Output:

- platform-specific title
- description / sales copy
- keyword strategy
- image plan
- missing-data checklist
- publishing readiness score
- task list

This is not audit. It is listing strategy generation.

### C. Batch Listing Preparation

Purpose:

- prepare many products/listings under shared rules
- surface only exceptions for operator review
- support future Rakuten CSV, Mercari CSV, Amazon offer preparation, and API payload generation

Human input level:

- `batch_brief_required`

Operator provides:

- platform
- shop
- product category / family / SPU group
- default title formula
- default description template
- shipping policy
- warranty / condition wording
- image rules
- forbidden claims
- batch objective

Qwen processes many products and surfaces exceptions:

- missing dimensions
- missing images
- unclear color
- bundle quantity mismatch
- price abnormal
- mapping conflict
- unsupported marketplace field

## Platform Priority

MVP priority should be:

1. Rakuten
2. Amazon
3. Hero products across platforms
4. Mercari batch optimization / CSV patch support

### Rakuten

Rakuten has the largest content-quality opportunity:

- title
- catch copy
- description
- SKU variation clarity
- image set
- search tags
- category / attributes
- sales page trust

Poor Rakuten listings directly damage conversion and store quality, so Rakuten should be the first marketplace workflow for Listing Intelligence.

### Amazon

Amazon MVP focus is operational correctness:

- seller SKU
- ASIN
- offer mapping
- variation relationship
- price
- stock
- listing status
- catalog data gap

Amazon content optimization is useful only after enough Amazon catalog/detail content is imported.

### Mercari

Mercari remains important, but CSV handling is already strong. It is better suited for batch improvement, CSV patch generation, and later marketplace-specific rewrite flows after the workbench is established.

## Human Input Model

Add `human_input_level` to work items and workflow outputs.

Allowed values:

```text
none
confirm_only
brief_required
batch_brief_required
expert_review_required
```

Examples:

| Workflow | Human input level |
|---|---|
| Amazon mapping audit | `confirm_only` |
| Rakuten hero optimization | `brief_required` |
| Mercari CSV batch rewrite | `batch_brief_required` |
| Missing image issue | `confirm_only` |
| New hero product page | `expert_review_required` |

## Hero Product Priority Model

Hero product should drive routing and priority, not just be a filter.

Target classification should derive:

- `is_hero`
- `hero_scope`
- `hero_priority`
- `hero_reason`
- `target_platforms`
- `listing_strategy_status`

Allowed `hero_scope` values:

```text
product_family
product_spu
variant
bundle
```

The existing `merchandising_focus_items` table remains useful, especially for SPU-level hero status. The workbench should also allow hero strategy work to target a family, variant, or bundle when the business case requires it.

## Supabase Read Models

### `listing_audit_inputs_v1`

Keep this read model for existing listing audit. It flattens normalized listing records into audit-ready rows.

Recommended row grain:

- one row per `platform_listing_skus.id` when SKU rows exist
- one fallback row per `platform_listings.id` when no SKU rows exist

Key fields:

```text
audit_target_id
audit_target_type
platform
shop_code
listing_id
listing_sku_id
external_listing_id
external_sku_id
seller_sku
sku_code
asin
listing_title
listing_description
listing_status
listing_status_code
sku_status
stock_status
category_name
current_price
stock_qty
currency
image_urls
attribute_summary
product_family_id
family_code
family_name
product_spu_id
spu_code
spu_title
manufacturer_model
variant_id
item_code
shop_sku
variant_name
color
size_text
material
commercial_summary
focus_type
focus_priority
source_snapshot
```

### `listing_target_classification_v1`

Add this read model before running Qwen.

Purpose:

- classify potential listing work from imported product/listing data
- generate candidate `listing_work_items`
- prioritize operational work without model calls

Recommended fields:

```text
target_id
target_type
work_type
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
business_priority
issue_severity
mapping_status
listing_status
stock_status
image_status
content_status
price_status
human_input_level
recommended_prompt_profile
source_context
priority_score
classification_reasons
```

## Core Queue Table: `listing_work_items`

`listing_work_items` is the central operational queue for Listing Intelligence.

It should exist before audit result tables are useful.

```sql
create table if not exists listing_work_items (
  id uuid primary key default gen_random_uuid(),
  work_type text not null,
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
  human_input_level text not null default 'confirm_only',
  status text not null default 'open',
  assigned_to text,
  source_context jsonb not null default '{}'::jsonb,
  classification_reasons jsonb not null default '[]'::jsonb,
  latest_result_id uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(work_type, platform, shop_code, product_family_id, product_spu_id, variant_id, bundle_id, listing_id, listing_sku_id),
  check (work_type in (
    'audit_existing_listing',
    'optimize_hero_listing',
    'prepare_batch_listing',
    'review_batch_listing',
    'fix_mapping',
    'fix_images',
    'check_price_stock',
    'rewrite_content',
    'manual_review'
  )),
  check (business_priority in ('low', 'normal', 'high', 'critical')),
  check (issue_severity in ('low', 'medium', 'high', 'critical')),
  check (human_input_level in ('none', 'confirm_only', 'brief_required', 'batch_brief_required', 'expert_review_required')),
  check (status in ('open', 'in_progress', 'waiting_for_input', 'ready_for_review', 'approved', 'ignored', 'task_created', 'closed'))
);
```

## Audit / Intelligence Result Tables

The earlier audit tables should remain, but they should attach to work items.

### `listing_intelligence_runs`

```sql
create table if not exists listing_intelligence_runs (
  id uuid primary key default gen_random_uuid(),
  run_type text not null,
  workflow_type text not null,
  platform text,
  shop_code text,
  filter_payload jsonb not null default '{}'::jsonb,
  status text not null default 'running',
  llm_provider text default 'local',
  llm_runtime text default 'ollama',
  llm_model text,
  prompt_profile text,
  prompt_version text,
  total_targets integer default 0,
  completed_targets integer default 0,
  failed_targets integer default 0,
  started_at timestamptz default now(),
  finished_at timestamptz,
  created_by text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  check (status in ('running', 'completed', 'failed', 'cancelled'))
);
```

### `listing_intelligence_results`

```sql
create table if not exists listing_intelligence_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references listing_intelligence_runs(id) on delete cascade,
  work_item_id uuid references listing_work_items(id) on delete cascade,
  work_type text not null,
  platform text,
  shop_code text,
  product_family_id uuid references product_families(id) on delete set null,
  product_spu_id uuid references product_spus(id) on delete set null,
  variant_id uuid references product_variants(id) on delete set null,
  bundle_id uuid references bundle_products(id) on delete set null,
  listing_id uuid references platform_listings(id) on delete set null,
  listing_sku_id uuid references platform_listing_skus(id) on delete set null,
  overall_score integer,
  priority text not null default 'medium',
  action_type text not null default 'manual_review',
  human_input_level text not null default 'confirm_only',
  human_review_required boolean not null default true,
  deterministic_findings jsonb not null default '[]'::jsonb,
  qwen_review_id uuid,
  summary text,
  source_snapshot jsonb not null,
  status text not null default 'open',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  check (priority in ('low', 'medium', 'high', 'critical')),
  check (action_type in ('no_action', 'rewrite', 'image_fix', 'price_check', 'mapping_fix', 'manual_review', 'create_task', 'prepare_batch', 'strategy_brief')),
  check (human_input_level in ('none', 'confirm_only', 'brief_required', 'batch_brief_required', 'expert_review_required')),
  check (status in ('open', 'approved', 'ignored', 'task_created', 'superseded'))
);
```

### `listing_qwen_reviews`

Local Qwen results should be stored separately from deterministic results.

```sql
create table if not exists listing_qwen_reviews (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references listing_intelligence_runs(id) on delete cascade,
  result_id uuid references listing_intelligence_results(id) on delete cascade,
  work_item_id uuid references listing_work_items(id) on delete cascade,
  llm_provider text not null default 'local',
  llm_runtime text not null default 'ollama',
  llm_model text not null,
  prompt_profile text not null,
  prompt_version text not null,
  input_hash text,
  output_hash text,
  risk_level text not null default 'medium',
  confidence numeric,
  summary text,
  issues jsonb not null default '[]'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  suggested_title text,
  suggested_description text,
  suggested_image_plan jsonb not null default '[]'::jsonb,
  structured_output jsonb not null default '{}'::jsonb,
  raw_request jsonb,
  raw_response jsonb,
  validation_status text not null default 'pending',
  validation_errors jsonb not null default '[]'::jsonb,
  repair_attempts integer not null default 0,
  error_message text,
  created_at timestamptz default now(),
  check (risk_level in ('low', 'medium', 'high', 'critical')),
  check (validation_status in ('pending', 'valid', 'repaired', 'invalid', 'failed'))
);
```

Backward-compatible names such as `listing_audit_runs`, `listing_audit_results`, and `listing_audit_llm_reviews` can be retained only if already implemented. For the new MVP design, prefer the `listing_intelligence_*` naming.

## Listing Batch Tables

Batch listing preparation is not an audit run. It needs its own tables.

### `listing_batches`

```sql
create table if not exists listing_batches (
  id uuid primary key default gen_random_uuid(),
  batch_type text not null,
  platform text not null,
  shop_code text not null,
  name text not null,
  product_family_id uuid references product_families(id) on delete set null,
  product_spu_id uuid references product_spus(id) on delete set null,
  human_brief jsonb not null default '{}'::jsonb,
  default_rules jsonb not null default '{}'::jsonb,
  platform_template jsonb not null default '{}'::jsonb,
  image_policy jsonb not null default '{}'::jsonb,
  forbidden_claims jsonb not null default '[]'::jsonb,
  shipping_policy jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  check (batch_type in ('rakuten_batch_listing', 'mercari_csv_patch', 'amazon_offer_preparation', 'category_listing_expansion')),
  check (status in ('draft', 'ready', 'processing', 'review', 'approved', 'exported', 'archived'))
);
```

### `listing_batch_items`

```sql
create table if not exists listing_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references listing_batches(id) on delete cascade,
  work_item_id uuid references listing_work_items(id) on delete set null,
  product_spu_id uuid references product_spus(id) on delete set null,
  variant_id uuid references product_variants(id) on delete set null,
  bundle_id uuid references bundle_products(id) on delete set null,
  listing_id uuid references platform_listings(id) on delete set null,
  listing_sku_id uuid references platform_listing_skus(id) on delete set null,
  generated_payload jsonb not null default '{}'::jsonb,
  validation_status text not null default 'pending',
  validation_errors jsonb not null default '[]'::jsonb,
  operator_status text not null default 'pending',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  check (validation_status in ('pending', 'valid', 'repaired', 'invalid', 'failed')),
  check (operator_status in ('pending', 'approved', 'rejected', 'needs_edit', 'exported'))
);
```

## Local Qwen Control Loop

Local Qwen should follow this required loop:

```text
source_snapshot
  -> deterministic precheck
  -> Qwen output
  -> JSON parse
  -> schema validation
  -> source-fact validation
  -> optional repair prompt
  -> save result
  -> operator review
```

Qwen can be used for:

- target classification assist
- rewrite suggestions
- SEO gap detection
- image plan
- listing strategy
- batch draft generation
- mapping assist

Qwen must not be trusted alone for:

- facts
- prices
- stock
- dimensions
- platform compliance
- unsupported claims
- JSON correctness

Validation requirements:

- parse structured JSON
- validate against workflow-specific JSON schema
- reject unsupported facts not found in `source_snapshot` or approved operator brief
- reject price/stock/dimension changes unless explicitly sourced
- run marketplace field validators
- allow one or two repair attempts
- persist `validation_status`, `validation_errors`, and `repair_attempts`

## Workflow Output Contracts

Each workflow should have its own prompt profile and JSON schema.

### Existing Listing Audit Output

```json
{
  "overall_score": 72,
  "risk_level": "medium",
  "summary": "The listing is understandable but weak on size and image clarity.",
  "issues": [
    {
      "type": "title_seo",
      "severity": "medium",
      "evidence": "Title does not include capacity or color.",
      "operator_note": "Add capacity and color only if confirmed by source data."
    }
  ],
  "recommendations": [
    {
      "action_type": "rewrite",
      "priority": "medium",
      "reason": "Title and description miss important buyer search terms."
    }
  ],
  "suggested_title": "...",
  "suggested_description": "...",
  "suggested_image_plan": [],
  "human_review_required": true,
  "confidence": 0.78
}
```

### Hero Product Strategy Output

```json
{
  "strategy_summary": "...",
  "target_buyer": "...",
  "positioning": "...",
  "keyword_strategy": ["..."],
  "platform_title": "...",
  "platform_description": "...",
  "image_plan": [
    {
      "image_type": "main",
      "purpose": "...",
      "required_source_fact": "..."
    }
  ],
  "missing_data_checklist": ["..."],
  "publishing_readiness_score": 68,
  "task_recommendations": []
}
```

### Batch Listing Preparation Output

```json
{
  "batch_summary": "...",
  "generated_items": [],
  "exceptions": [
    {
      "item_code": "...",
      "exception_type": "missing_images",
      "severity": "high",
      "operator_note": "Cannot prepare listing until main image is available."
    }
  ],
  "export_readiness": "review_required"
}
```

## Deterministic Validators

Validators should cover:

- required title fields by platform
- required description/catch-copy fields by platform
- price present and numeric
- stock status consistency
- active listing with zero stock
- unknown listing or SKU status
- missing product mapping
- listing SKU without `variant_id`
- conflicting product-platform links
- image count and required image type
- forbidden claims
- unsupported dimensions, colors, materials, or bundle quantities
- platform field length limits
- JSON schema validity

These validators are the authority. Qwen output that fails validation should be repaired or marked invalid.

## Operator Workbench UI

The `/listing` page should become the Listing Intelligence Workbench.

### Main View

Filters:

- platform
- shop
- work type
- status
- priority
- human input level
- hero only
- mapping status
- Product Family
- SPU
- search by item code, seller SKU, title, ASIN, listing ID

Columns:

- priority score
- work type
- human input level
- platform/shop
- Product Family
- SPU
- item code / seller SKU
- title or target name
- issue severity
- latest recommendation
- validation status
- work status

### Detail View

Show:

- why this work item exists
- source context
- Product Family / SPU / Variant / Listing SKU trace
- deterministic findings
- Qwen summary and recommendations
- validation status and validation errors
- suggested title / description / image plan
- required human input brief if applicable
- raw source snapshot expandable section

Operator actions:

- approve
- ignore
- regenerate
- create task
- mark needs mapping fix
- submit brief
- add to batch

No direct marketplace execution in MVP.

## Task Creation

When an operator clicks `Create Task`, create a task record using the existing task system.

Suggested mapping:

| Work type / action | Task type |
|---|---|
| `rewrite_content` | `listing_content_update` |
| `fix_images` | `listing_image_update` |
| `check_price_stock` | `pricing_review` |
| `fix_mapping` | `product_mapping_review` |
| `optimize_hero_listing` | `hero_listing_strategy` |
| `prepare_batch_listing` | `listing_batch_preparation` |
| `manual_review` | `listing_manual_review` |

Task target should include:

- work item ID
- intelligence result ID
- listing ID
- listing SKU ID
- platform/shop
- product family ID
- product SPU ID
- variant ID
- bundle ID if applicable

## CLI / Job Interface

Add these jobs:

```bash
npm run job:listing:classify -- --platform=rakuten --shop=homebliss
npm run job:listing:classify -- --platform=amazon --shop=jp
npm run job:listing:intelligence -- --work-type=audit_existing_listing --platform=rakuten --shop=homebliss --limit=50
npm run job:listing:intelligence -- --work-type=optimize_hero_listing --focus-type=hero
npm run job:listing:batch -- --platform=rakuten --shop=homebliss --batch-id=<id>
```

Recommended options:

```text
--platform
--shop
--work-type
--status
--focus-type
--human-input-level
--limit
--dry-run
--force
--only-unresolved
--only-stale
--llm-runtime
--llm-model
--prompt-profile
```

Default behavior:

- run classification before Qwen
- skip work items that are fresh and valid unless `--force` is used
- cap Qwen batch size
- store failures per work item instead of failing the whole run
- mark work items requiring briefs as `waiting_for_input`

## Implementation Sequence

### Phase 1 — Data Readiness

- build `listing_audit_inputs_v1`
- build `listing_target_classification_v1`
- classify Rakuten, Amazon, Mercari, and hero targets
- create `listing_work_items`

### Phase 2 — Workbench

- create `/listing` workbench
- show prioritized work items
- filter by platform, work type, hero, mapping status, and human input level
- support basic status changes: ignore, approve, create task

### Phase 3 — Local Qwen

- add local Qwen adapter through Ollama
- add prompt profiles
- add workflow-specific JSON schemas
- add JSON parse, schema validation, source-fact validation, and repair attempts

### Phase 4 — Rakuten + Amazon Workflows

- Rakuten content/readiness audit
- Amazon offer/mapping audit
- persist Qwen results and validation output

### Phase 5 — Hero Workflow

- hero product brief
- platform-specific listing strategy output
- missing data checklist
- task recommendations

### Phase 6 — Batch Workflow

- add `listing_batches`
- add `listing_batch_items`
- batch item exception review
- prepare for Mercari/Rakuten CSV generation later

## First Implementation Target

Build the workbench before building a large LLM job.

First useful implementation:

1. Create `listing_target_classification_v1`.
2. Create `listing_work_items`.
3. Generate work items from imported Rakuten active listings, Amazon active offers/mappings, and hero SPUs.
4. Update `/listing` to show work items from Supabase.
5. Add filters for platform, work type, hero, mapping status, and status.
6. Add task creation from work items.
7. Add local Qwen only after operators can use the workbench queue.

## MVP Includes

- `listing_audit_inputs_v1`
- `listing_target_classification_v1`
- `listing_work_items`
- `listing_intelligence_runs`
- `listing_intelligence_results`
- `listing_qwen_reviews`
- local Qwen adapter
- deterministic validation engine
- platform prompt profiles
- `/listing` workbench UI
- task creation
- no automatic marketplace update

## MVP Does Not Include

- automatic publishing
- full competitor scraping
- image generation
- complex queue infrastructure
- multi-tenant configuration
- direct marketplace mutation
- fully automated hero strategy without human brief

## Critical Safety Rule

Local Qwen is the default generator and reasoner.

Supabase source data and deterministic validators are the authority.

Humans approve high-risk or externally visible changes.

This rule exists because bad listing output can cause:

- wrong product claims
- wrong size/color
- wrong bundle quantity
- marketplace compliance problems
- customer complaints
- margin loss
- brand damage

## Open Decisions

1. Which local Qwen model should be the first supported default.
2. Whether Ollama is the only MVP runtime or whether the adapter should support other local runtimes from the start.
3. Whether read-only workbench and task creation should ship before any Qwen call.
4. Whether unresolved listings should receive only deterministic `fix_mapping` work items before Qwen is allowed.
5. Whether operator approval should happen at work-item level or per recommendation item.
6. Which Rakuten fields should be included in the first prompt profile.
7. What brief template should be required for hero product optimization.
