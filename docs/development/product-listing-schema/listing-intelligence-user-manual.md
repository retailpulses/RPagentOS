# Listing Intelligence User Manual

Date: 2026-07-06

Audience: Retailpulses operators and managers using `/listing`.

Scope: MVP-0 and MVP-1 Listing Intelligence Workbench.

## What This Feature Does

Listing Intelligence turns imported marketplace/product data into an operator work queue.

The workbench helps you:

- see listing problems across Rakuten, Amazon, Mercari, and hero products
- filter the work queue by platform, shop, workflow, issue, status, hero-only, and search
- inspect why each work item exists
- create human tasks from work items
- run local Qwen review for eligible Rakuten/Amazon/Mercari audit items
- keep AI review suggestions separate from source-of-truth product/listing facts

The workbench does not publish listings, edit marketplace data, export CSVs, or automatically fix stock/price/mapping.

## Access

Open:

```text
https://agent.homesbliss.net/listing
```

The page is backed by Supabase. The visible work queue comes from `listing_work_items`.

## Core Concepts

### Work Item

A work item is one listing/product issue that needs review, action, or future strategy.

Examples:

- Rakuten listing SKU has zero stock while active
- Amazon offer/listing mapping needs review
- Mercari listing is missing images
- Hero product needs future strategy work

### Workflow Type

The workflow type tells you what kind of work this is.

- `audit_existing_listing`: review an existing marketplace listing
- `optimize_hero_listing`: future hero product strategy input

### Issue Type

The issue type tells you why the item exists.

Common MVP issue types:

- `price_stock_mismatch`
- `missing_mapping`
- `missing_images`
- `unknown_status`

### Qwen Review

Qwen review is a local AI review step for eligible Rakuten/Amazon/Mercari work items.

Qwen can summarize, score risk, and recommend next action. Qwen cannot change source facts or publish anything.

## User Stories

### Story 1: See The Highest-Priority Listing Work

As an operator, I want to open the Listing Intelligence page and see the most urgent listing work first, so I know where to start.

Steps:

1. Open `/listing`.
2. Look at the summary metrics: Work Items, Open, High, Hero.
3. Review the list on the left.
4. Select a row to inspect details.

Expected result:

- The list shows the highest-priority work items first.
- The detail panel shows trace IDs, source context, deterministic findings, and snapshot information.

Note:

- The first page shows up to 200 work items.
- The full cloud queue can contain more items than the first visible page.

### Story 2: Filter By Marketplace Or Shop

As an operator, I want to filter the queue by marketplace/shop, so I can focus on the channel I am working on.

Steps:

1. Use `Platform` to choose `amazon`, `mercari`, or `rakuten`.
2. Use `Shop` to choose:
   - `amazon`
   - `mercari shop4`
   - `rakuten`
3. Review the filtered work items.

Expected result:

- The list narrows to matching items.
- The selected filter values remain readable for operators.

Important:

- The displayed shop names are operator labels.
- The database still stores internal shop codes such as `homebliss`, `jp`, and `shop4`.

### Story 3: Search For A Specific SKU Or Listing

As an operator, I want to search by SKU, title, ASIN, item code, or listing ID, so I can quickly find a specific problem.

Steps:

1. Type into the `Search` field.
2. Use values such as seller SKU, SKU code, ASIN, title text, SPU code, or listing ID.
3. Select the matching result.

Expected result:

- The visible list narrows to matching work items.
- The detail panel updates to the selected item.

### Story 4: Understand Why A Work Item Exists

As an operator, I want to know why the system created a work item, so I can decide whether it needs action.

Steps:

1. Select a work item.
2. Read `Classification Reasons`.
3. Read `Deterministic Findings`.
4. Read `Source Context`.
5. Check the trace section for Family, SPU, Variant, Listing, Listing SKU, and Snapshot.

Expected result:

- `Classification Reasons` explains the system rule that created the item.
- `Deterministic Findings` shows rule-based evidence.
- `Source Context` shows the listing/product fields used to classify the item.
- Snapshot hash/version show which source state the work item was based on.

Operator rule:

- Treat source context and deterministic findings as stronger evidence than Qwen suggestions.

### Story 5: Create A Task From A Work Item

As an operator, I want to create a normal RPagentOS task from a listing work item, so the issue can be assigned and tracked.

Steps:

1. Select a work item.
2. Click `Create Task`.
3. Confirm the work item status changes to `task_created`.
4. Use the task board to continue handling it.

Expected result:

- A task is created with listing metadata.
- The task target links back to the work item target.
- The work item status changes so it is not treated as untouched.

Typical task mappings:

- `missing_mapping` -> product mapping review
- `missing_images` -> listing image update
- `price_stock_mismatch` -> pricing/stock review
- hero gap -> hero listing strategy

### Story 6: Ignore A Work Item

As an operator, I want to ignore work that is not actionable, so the queue stays focused.

Steps:

1. Select a work item.
2. Click `Ignore`.
3. Refresh or change filters if needed.

Expected result:

- The item status changes to `ignored`.
- It can be filtered later by status if needed.

Use this when:

- the issue is known and intentionally accepted
- the source data is stale but not worth action
- the recommendation is not relevant for current operations

### Story 7: Mark A Work Item As Waiting For Input

As an operator, I want to mark an item as waiting for input, so it does not look ready for immediate action.

Steps:

1. Select a work item.
2. Click `Mark Waiting Input`.

Expected result:

- The item status changes to `waiting_for_input`.

Use this when:

- product information is missing
- mapping requires human confirmation
- content, images, or pricing require another source before action

### Story 8: Run Qwen Review For Eligible Rakuten/Amazon/Mercari Items

As an operator, I want Qwen to review eligible Rakuten/Amazon/Mercari audit items, so I get a structured second opinion before creating work.

Prerequisite:

The local Qwen bridge must be running against the same database as the workbench.

For cloud workbench operation:

```bash
npm run qwen:bridge:cloud
```

Steps:

1. Open `/listing`.
2. Filter to `rakuten`, `amazon`, or `mercari`.
3. Select an eligible `audit_existing_listing` item.
4. Click `Run Qwen Review`.
5. Wait for the local bridge to process the queued request.
6. Read the `Qwen Review` section in the detail panel.

Expected result:

- A Qwen request is queued in Supabase.
- The local bridge picks it up.
- Ollama runs `qwen3.5:9b`.
- A review is stored in `listing_qwen_reviews`.
- The latest review appears in the detail panel.

Qwen review shows:

- validation status
- model and prompt profile
- summary
- risk level
- confidence
- issues
- recommendations
- suggested title/description/image plan when grounded in source facts
- validation errors if output was invalid

### Story 9: Know When Qwen Is Not Allowed

As an operator, I want Qwen to be blocked for unsafe cases, so AI does not review incomplete or unresolved source data.

Qwen is blocked when:

- platform is not Rakuten or Amazon
- workflow is not `audit_existing_listing`
- issue is `missing_mapping`
- recommended action is `create_mapping_task`
- hidden deterministic findings include unresolved mapping
- item belongs to hero strategy workflow

Expected result:

- The `Run Qwen Review` button is disabled or the bridge rejects the request.
- Mapping-first items stay deterministic and human-reviewed.

### Story 10: Interpret A Qwen Review

As an operator, I want to understand what Qwen output means, so I can use it without over-trusting it.

Read Qwen output like this:

1. Check `validation_status`.
2. Check `summary`.
3. Check `issues`.
4. Check `recommendations`.
5. Compare suggestions against `Source Context`.
6. Create a task only when the recommendation is useful.

Validation statuses:

- `valid`: output passed validation
- `repaired`: first output failed but was repaired successfully
- `invalid`: output did not pass validation
- `failed`: Qwen or bridge failed

Operator rule:

- Qwen is advice, not authority.
- Source context and deterministic findings remain the source of truth.
- Do not copy unsupported claims into marketplace listings.

## Current MVP Limits

### MVP-0 Limits

MVP-0 gives a workbench, filters, detail panel, status updates, and task creation.

It does not:

- use Qwen
- generate marketplace-ready content
- export CSVs
- publish marketplace changes

### MVP-1 Limits

MVP-1 adds local Qwen review for eligible Rakuten/Amazon/Mercari audit items.

It does not:

- run Qwen for every work item
- run Qwen automatically for all queued work
- support Mercari CSV rewrite/batch workflows
- support hero strategy generation
- publish listings
- change price or stock
- fix product mappings automatically
- generate CSV export files

## Daily Operating Flow

1. Open `/listing`.
2. Filter by the marketplace/shop you are working on.
3. Handle deterministic issues first:
   - missing mappings
   - missing images
   - unknown status
   - price/stock mismatch
4. For eligible Rakuten/Amazon/Mercari audit items, run Qwen review.
5. Read the review and source context together.
6. Create tasks for real work.
7. Ignore or mark waiting input when appropriate.

## Troubleshooting

### The Page Shows Only 200 Work Items

This is normal. The UI shows the top 200 matching items for speed.

Use filters/search to narrow the queue.

### Qwen Review Does Not Appear

Check:

1. Is the local bridge running?
2. Is it pointed at the same database target as the page?
3. Is Ollama running?
4. Is `qwen3.5:9b` available?
5. Is the work item eligible?

Useful command:

```bash
curl http://127.0.0.1:8788/health
```

Expected:

```json
{"ok":true,"service":"rpagentos-listing-qwen-bridge"}
```

### Qwen Button Is Disabled

The item is probably not eligible for MVP-1 Qwen review.

Common causes:

- hero workflow
- missing mapping issue
- unresolved mapping finding

### Qwen Review Says Invalid Or Failed

Do not use the recommendation directly.

Check validation errors, source context, and deterministic findings. Create a manual task if the issue still matters.

## Operator Safety Rules

- Do not treat Qwen as source truth.
- Do not publish from Qwen output.
- Do not invent missing product facts.
- Fix mapping before Qwen review.
- Use tasks for human-owned follow-up work.
- Keep the bridge local; do not expose it publicly.

## Glossary

`listing_work_items`: Supabase table containing the work queue.

`listing_target_classification_v1`: deterministic view that finds listing targets and issues.

`listing_qwen_review_requests`: queue table used by the live page to request local Qwen reviews.

`listing_qwen_reviews`: saved Qwen review outputs.

`source_context`: source fields used for classification and review.

`source_snapshot_hash`: stable hash used to know which source state the work item/review belongs to.

`deterministic_findings`: rule-based findings created without Qwen.

`Qwen bridge`: local process that polls review requests and calls Ollama.
