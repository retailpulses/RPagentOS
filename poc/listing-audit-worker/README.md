# Listing Audit Worker — Local POC

## Purpose

Validate whether `qwen3.5:9b` can produce useful, schema-valid listing audit results for the Agent OS MVP. The worker analyzes ecommerce listings and produces structured recommendations for human review. It does **not** execute any changes.

## Why inside RPagentOS?

This POC represents a future Agent OS worker — a local LLM-based audit component that would eventually run as part of the Agent OS runtime. It sits inside this repo to keep all Agent OS research co-located.

## Why under `poc/` instead of `packages/workers/`?

- Not production-ready yet.
- Not connected to any data pipeline.
- Uses only local sample input and local Ollama endpoint.
- May change significantly based on test results.

Move to `packages/workers/listing-audit/` only after promotion criteria are met.

## Prerequisites

- **Ollama** installed locally
- Models pulled:
  - Primary: `qwen3.5:9b` (multimodal, ~9.7B params)
  - Fallback: `qwen3:8b` (text-only)
- Python 3.9+

## Setup

```bash
pip install -r poc/listing-audit-worker/requirements.txt
```

The script fails fast with a clear message if dependencies are missing.

## How to run

```bash
# Default (primary: qwen3.5:9b, fallback: qwen3:8b)
python3 poc/listing-audit-worker/audit_listings.py

# Override model
python3 poc/listing-audit-worker/audit_listings.py --model qwen3.5:9b

# Custom sample file
python3 poc/listing-audit-worker/audit_listings.py --samples my-listings.json
```

### Expected output

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Listing Audit Worker — POC
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Model       : qwen3.5:9b
  Time        : 2026-07-01 14:30:00
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Listings    : 8
  Successful  : 7
  Repaired    : 1
  Failed      : 1
    Parse err : 1
    Schema err: 0
  Avg time    : 3.2s per listing
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Results: poc/listing-audit-worker/output/audit_results.jsonl
  Failed : poc/listing-audit-worker/output/audit_failed.jsonl
```

## Input format

`samples/listings.sample.json` contains 8 mixed-quality Japanese ecommerce listings derived from real Homebliss product data. Image paths are empty (`[]`) but the field exists for future expansion.

Each listing includes:

| Field | Description |
|-------|-------------|
| `listing_id` | Unique sample identifier |
| `platform` | `mercari`, `rakuten`, or `amazon` |
| `shop_code` | Shop identifier |
| `title` | Listing title |
| `description` | Listing description |
| `price` | Listed price in JPY |
| `stock` | Available quantity |
| `category` | Product category |
| `product_facts` | Structured specs (sku, spu, color, size, material) |
| `image_paths` | Array of image URLs (empty in sample) |

## Output files

### `output/audit_results.jsonl`

One JSON object per successfully audited listing. Each line is a complete result with:
- `listing_id`, `status`, `model_used`, `repaired`, `runtime_seconds`
- `output`: the validated audit result matching `schema.json`

### `output/audit_failed.jsonl`

One JSON object per failed listing. Each line includes:
- `listing_id`, `status`, `model_used`, `runtime_seconds`
- `error`: failure reason (`parse_failure`, `schema_failure`, or `model_unavailable`)
- `raw_output`: the raw model output (for debugging)

## Validation behavior

1. Model output must be valid JSON.
2. JSON must match `schema.json` exactly (enforced by `jsonschema`).
3. If parsing or validation fails, the script retries **once** with a repair prompt.
4. If the repair succeeds, the result is marked `repaired: true`.
5. If the repair fails, the raw output + error is saved to `audit_failed.jsonl`.

### Fallback model

The fallback (`qwen3:8b`) is used **only** if the primary model's HTTP call fails (e.g., model not found, Ollama unreachable). It is **not** used when JSON parse or validation fails.

## Schema enforcement

| Field | Constraints |
|-------|------------|
| `overall_score` | Integer, 0–100 |
| `*.score` | Integer, 0–100 |
| `platform` | Enum: `mercari`, `rakuten`, `amazon` |
| `pricing_risk.level` | Enum: `low`, `medium`, `high` |
| `action_recommendation.type` | Enum: `no_action`, `rewrite`, `manual_review`, `price_check`, `image_fix` |
| `action_recommendation.priority` | Enum: `low`, `medium`, `high` |
| `issues` | Must be array (may be empty) |
| `suggested_title`, `suggested_description` | Must be string |

## Current limitations

- `image_paths` are empty in all samples — image analysis not yet tested.
- Only Mercari and Rakuten platforms in sample data.
- No connection to production data or APIs.
- All recommendations are for human review only — no automated execution.
- Japanese language output quality depends on model capability.
- Runtime may be slow on batch workloads (sequential processing).

## Promotion criteria

Do **not** move this to `packages/workers/listing-audit/` until batch testing shows:

| Metric | Target |
|--------|--------|
| JSON parse success | >= 95% |
| Schema validation success | >= 90% |
| Useful recommendation rate | >= 70% |
| Dangerous wrong recommendation | 0% |
| Runtime | Acceptable for local batch work |
