# Inquiry-Linked Main Image — Lean MVP Design

Status: **Implementation complete — production deployment approved**

Tracking issue: [retailpulses/RPagentOS#74](https://github.com/retailpulses/RPagentOS/issues/74)

Coordination references:

- [inquiry-automation PR #62](https://github.com/retailpulses/inquiry-automation/pull/62) — exact-listing resolution and text optimization
- [RPagentOS PR #77](https://github.com/retailpulses/RPagentOS/pull/77) — operator-confirmed text publishing and shared publication lock
- [CatalogSync PR #139](https://github.com/retailpulses/CatalogSync/pull/139) — fixed-IP Mercari text relay

## 1. MVP outcome

From one inquiry, an operator can:

1. Open a separate Main Image workspace.
2. See the exact inquiry-linked Mercari listing and its current main image.
3. Build a grounded product fact pack from the SPU1 relationship, variants,
   current title/description, and verified source images, then generate a
   constrained schema from it.
4. Review the fact evidence, edit the schema, and approve it.
5. Generate one candidate image.
6. Approve that candidate.
7. Explicitly save it as an immutable R2 asset.
8. Explicitly publish it as position 1 on that exact listing.
9. See success or failure and retain the previous image order for manual rollback.

This is the smallest complete operator path. It does not attempt to build a
general creative-asset workflow engine.

## 2. Hard boundaries

- Start from an inquiry, never an order or free-form SPU search.
- Resolve exactly one listing using the inquiry's primary product link,
  marketplace, and shop.
- Missing or ambiguous listing mapping blocks the workflow.
- Product family and variation data are generation context only. They do not add
  publication targets.
- Resolve sibling variants through the canonical `product_spu_id`/SPU1
  relationship, never by fuzzy item-code or title matching.
- Current title and description are useful keyword/feature leads, but are not
  proof that a factual claim is true. Uncorroborated leads cannot enter the
  image-generation prompt without explicit operator confirmation.
- Visual observations may guide layout and product-fidelity checks; they do not
  authorize textual claims.
- Never update equivalent listings in another shop.
- Main-image actions remain separate from title/description `Publish All`.
- Browser requests cannot substitute another listing, shop, candidate URL, or R2 key.
- Operator confirmation is required before R2 save and before Mercari publish.
- Authentication, exact identity, content revision, idempotency, image
  validation, marketplace credentials, and marketplace readback remain blocking.
- UI must remain safe with Chrome automatic page translation. Only stable IDs
  use `translate="no"`.

## 3. Intentionally deferred

The MVP does **not** include:

- Multiple providers or multiple candidates
- Dedicated workflow/project/schema/publication tables
- Schema version history UI
- Background job queues
- Automatic retries
- Automatic rollback
- Multi-shop publishing
- Rakuten publishing
- Bulk SPU processing
- A/B testing or automatic image scoring

These can be added only after operators prove the basic flow is useful.

## 4. Minimal architecture

```text
Inquiry Portal
  ├─ resolves the exact listing again on every write
  ├─ owns temporary UI state: editable schema and generated candidate
  └─ calls RPagentOS with a server-side token
                         │
                         ▼
RPagentOS owner API
  ├─ loads canonical product/listing/image context
  ├─ builds an evidence-tagged SPU fact pack
  ├─ calls OpenAI for one strict schema and one image candidate
  ├─ rejects schema fields that are not grounded in the fact pack
  ├─ signs candidate identity without persisting a temporary asset
  ├─ validates and saves the approved image to R2
  ├─ uses listing revision + shared publication claim
  └─ calls CatalogSync and records the result
                         │
                         ▼
CatalogSync fixed-IP relay
  ├─ chooses the exact shop credential server-side
  ├─ replaces Mercari image position 1
  └─ verifies listing identity and returned image order
```

### Why no workflow tables yet

Before an asset is saved, schema and candidate state can remain in the operator
page. Refreshing the page restarts generation, which is acceptable for the first
MVP.

Supabase already holds the canonical inputs in `product_spus`,
`product_variants`, `product_assets`, `platform_listings`, and listing
attributes. It does not have a standalone, generic product fact-pack source.
The existing copy workflow's `verified_claim_pack` is generated at runtime and
stored as a listing-review snapshot; it is copy-specific and currently includes
category-specific logic, so Main Image must not treat it as canonical product
data.

After save/publish, reuse existing records:

- `product_assets` — durable approved R2 asset plus the approved fact-pack and
  schema snapshot in metadata
- `platform_listing_images` — current ordered listing images
- `platform_listing_events` — save/publish/failure/rollback audit events
- `platform_listings.content_revision` and the shared publication claim — concurrency

No database migration is required for the first implementation PR.

### Fact-pack reuse and refresh

The MVP rebuilds `image_fact_pack` from canonical sources when schema generation
starts. It does not run a background fact-refresh job or create a second product
source of truth.

When an approved image is explicitly saved, `product_assets.metadata.main_image`
stores:

- canonical source snapshot and source hash
- generated fact pack and fact-pack hash
- operator-confirmed context-only evidence IDs
- operator exclusions and temporary overrides with an optional reason
- approved schema, prompt version, and schema model

A future session may preload that snapshot only when the current canonical
source hash is identical. If any source field, variant relationship, listing
revision, or source asset changes, RPagentOS rebuilds the pack and requires
review again. Operator overrides never silently update canonical product tables
and never carry across a changed source hash.

## 5. Repository responsibilities

### Inquiry Portal (`inquiry-automation`)

Add a sibling image component/page rather than changing the text optimization
payload or buttons. Recommended route:

```text
/inquiries/:inquiryId/main-image
```

The BFF reuses PR #62's exact-listing resolution rule. Before every save or
publish it re-resolves the inquiry and passes the owner API only the canonical
listing ID and current revision. The browser never chooses a listing ID.

For the first MVP the page holds:

- read-only canonical facts and evidence
- optional include/exclude confirmation for context-only feature/keyword leads
- optional session-scoped fact labels/overrides with a visible warning
- proposed/edited schema JSON
- one candidate preview, candidate bytes, and signed candidate token
- operator checklist state
- saved asset response

### RPagentOS

Add a separate `main-image` module and routes. Do not modify the text publisher
or couple image fields to it.

RPagentOS owns:

- canonical context reads
- deterministic SPU fact-pack assembly
- OpenAI schema and image calls
- strict structured-output and semantic schema validation
- short-lived candidate token signing and verification
- approved candidate byte validation
- checksum and immutable R2 write
- `product_assets` record
- listing claim/revision checks
- canonical image update and audit

### CatalogSync

Add a separate relay action:

```text
listing-image-update
```

It is not part of text `listing-text-update`.

## 6. Lean API

Exact filenames may follow Cloudflare Pages routing conventions.

### Load context

```http
GET /api/internal/catalog/listings/:listingId/main-image-context
```

Returns:

- exact platform/shop/external listing ID
- content revision
- target item code and canonical SPU1/product-SPU identity
- current listing title and description
- selected variant and every active sibling variant under the same
  `product_spu_id`, including item code, name, color/color code, size, material,
  quantity, and other allowlisted populated attributes
- current ordered listing images
- usable SPU/variant-linked `product_assets` source images with stable asset IDs

Blocks non-Mercari, missing marketplace identity, ambiguous catalog data, or no
usable source image.

### Generate schema

```http
POST /api/internal/catalog/listings/:listingId/main-image-schema
```

RPagentOS first builds a deterministic `image_fact_pack`; OpenAI does not receive
an unstructured database dump. The fact pack contains:

- canonical product/SPU/selected-variant identity
- all same-SPU variant facts and their linked source image IDs
- allowlisted catalog and listing attributes with evidence references
- current title/description terms tagged as `context_only`
- features/keywords corroborated by canonical fields tagged as `verified`
- conflicts, missing fields, and unsupported claims

The model returns one schema through OpenAI Structured Outputs with
`strict: true`. Each proposed feature, keyword, variation, swatch, and text
module must cite IDs from the supplied fact pack. The server rejects unknown
IDs, unsupported numeric tokens, unverified variants, invalid source-image IDs,
forbidden claims, and mandatory restrictions that were weakened.
For this lean MVP, generated copy may contain only exact cited evidence values
joined by punctuation; the validator rejects a plausible-sounding label that
merely attaches an unrelated evidence ID. Empty copy is preferred when no safe,
useful evidence value exists.

The endpoint returns the read-only fact pack, proposed schema, validation
results, warnings, prompt version, model, and input hash. In Schema Review the
operator sees evidence beside each feature/keyword. `context_only` suggestions
are excluded from the image prompt unless the operator explicitly confirms
them. The operator may exclude a suggestion, edit its display label, or add a
session-only override with a reason. Canonical identity, SPU membership, source
asset linkage, and evidence provenance remain read-only. The schema itself is
editable. Every confirmation or edit triggers validation again. Missing or
conflicting data is shown; the system never silently fills it.

### Generate one candidate

```http
POST /api/internal/catalog/listings/:listingId/main-image-candidate
```

Request contains the edited schema, approved fact-pack hash, explicitly
confirmed context-only evidence IDs, and expected content revision. RPagentOS
rebuilds the fact pack, validates every reference, and calls the OpenAI Image
API edit endpoint with the verified source image or images. Response contains:

- candidate image bytes encoded as base64
- short-lived server-signed candidate token
- provider/model and schema hash
- output dimensions and content type

The browser holds the candidate bytes only for the current review session.
RPagentOS does not create a durable asset before explicit approval. The signed
token binds the listing ID, expected content revision, image SHA-256, schema
hash, fact-pack hash, model, and expiry so the browser cannot substitute another
candidate or stale source context.

### Save approved candidate

```http
POST /api/internal/catalog/listings/:listingId/main-image-assets
```

Request contains the candidate bytes, signed candidate token, approved fact-pack
snapshot, operator confirmations/overrides, approved schema, expected revision,
and `operator_confirmed: true`.

RPagentOS verifies the token signature, expiry, listing/revision binding, schema
hash, and image checksum before validating or saving the bytes. It never fetches
a browser-supplied URL.

### Publish saved asset

```http
POST /api/internal/catalog/listings/:listingId/operator-main-image-publishes
```

Request contains the saved `product_assets.id`, expected content revision,
bounded idempotency key, and `operator_confirmed: true`.

### Manual rollback record

For MVP, the publish event stores the complete previous image order for an
operator-assisted manual rollback. An interactive rollback endpoint/button is
an explicit follow-up and is not part of this PR.

## 7. Schema quality and rules

### Grounding pipeline

Schema quality is a blocking MVP requirement, not a prompt-only concern:

1. Re-read the exact listing and revision.
2. Follow `platform_listings.product_spu_id` to `product_spus` and load all
   active `product_variants` with that same ID.
3. Load only SPU/variant-linked product assets and allowlisted attributes.
4. Build the evidence-tagged fact pack deterministically. Existing
   `verified_claim_pack`/claim-attribution patterns may be reused, but the
   image module remains independent from suitcase-specific copy logic.
5. Start from a conservative server-owned schema template. Ask OpenAI to select
   evidence IDs and choose only bounded layout values (enums/ranges) using
   strict JSON Schema; do not ask it to invent the product strategy from raw
   prose.
6. Run deterministic semantic validation before showing the schema.
7. Require operator review of facts, copy, layout, variants, and warnings before
   candidate generation.

If the SPU relationship is missing, the MVP may generate a single-product
schema but disables the variation module and shows a blocking warning for any
variation claim. Conflicting variant facts are omitted. No usable source image
blocks generation completely.

### Lean schema

Keep the creative schema small and evidence-linked:

```json
{
  "schema_version": "1.0",
  "canvas": {
    "width": 1024,
    "height": 1024,
    "background_color": "#F7F4EE"
  },
  "product": {
    "scale_percent": 73,
    "alignment": "center-right",
    "preserve_original_product": true,
    "source_asset_ids": ["asset-id"]
  },
  "copy": {
    "headline": "",
    "headline_evidence_ids": [],
    "supporting_text": "",
    "supporting_evidence_ids": []
  },
  "feature_ids": [],
  "keyword_ids": [],
  "variation_swatches": [
    {
      "variant_id": "variant-id",
      "label": "ベージュ",
      "color": "#D8C3A5",
      "source_asset_id": "asset-id"
    }
  ],
  "restrictions": {
    "no_people": true,
    "no_logo": true,
    "no_fake_discount": true,
    "no_fake_ranking": true,
    "no_fake_certification": true,
    "no_unverified_claims": true,
    "no_product_modification": true
  },
  "notes": ""
}
```

Mandatory restrictions cannot be disabled. Swatches must come from verified
variants belonging to the same product SPU and must reference a linked source
asset. Evidence IDs must exist in the approved fact pack. Any edit invalidates
the previous validation result and must pass validation again.

## 8. OpenAI generation

Configuration:

```text
OPENAI_API_KEY
OPENAI_SCHEMA_MODEL=gpt-5.4
OPENAI_IMAGE_MODEL=gpt-image-2
MAIN_IMAGE_CANDIDATE_SIGNING_SECRET
```

The existing server-side `OPENAI_API_KEY` is the only generation credential.
Schema generation defaults to `gpt-5.4` through the Responses API with strict
Structured Outputs. A model override is allowed only after it passes the same
schema-quality gate; it is not an automatic cost fallback. JSON shape compliance
is necessary but not sufficient, so the server separately enforces fact-pack
evidence and business rules. Image generation uses `gpt-image-2` by default
through:

```text
POST /v1/images/edits
```

The verified original product image is supplied as an edit reference to retain
product fidelity. The MVP requests exactly one 1024×1024 JPEG candidate at
medium quality with compression around 90. OpenAI returns base64 image data;
RPagentOS checks its bytes and hashes it before signing the candidate token.

If the API key or signing secret is not configured, generation returns
`generation_not_configured`; it never produces a placeholder image or silently
falls back to another provider.

## 9. R2 save

Configuration:

```text
MAIN_IMAGE_ASSETS
MAIN_IMAGE_ASSET_PUBLIC_BASE_URL
```

On explicit save:

1. Verify the signed candidate token and candidate checksum.
2. Validate magic bytes, content type, byte limit, square dimensions, and the
   configured main-image dimensions.
3. Reject SVG.
4. Calculate SHA-256.
5. Write once to an immutable key.
6. Insert `product_assets` with the R2 key, delivery URL, checksum, dimensions,
   item/listing reference, model, approved fact-pack/source hashes, operator
   confirmations/overrides, and schema snapshot in metadata.

Object key:

```text
products/{item_code}/main-images/{asset_id}/v1.{extension}
```

Saving does not publish.

### Selected R2 deployment

The preferred choice was a dedicated RPagentOS bucket, but the current machine
has no valid Wrangler login or configured Cloudflare API token, so it cannot be
created directly in this session. Per operator direction, the MVP will reuse and
repurpose the existing `boutique-listing-images-prod` bucket as a shared listing
image asset bucket.

RPagentOS configuration:

```text
binding = MAIN_IMAGE_ASSETS
bucket_name = boutique-listing-images-prod
```

The existing boutique-listing Worker keeps its `BOUTIQUE_IMAGES` binding to the
same physical bucket. Ownership is separated by immutable key namespace;
RPagentOS writes only under:

```text
products/{item_code}/main-images/{asset_id}/v1.{extension}
```

RPagentOS exposes a stable, unauthenticated, read-only delivery route under
`https://rpagentos.pages.dev/api/main-image-assets/*` so Mercari can retrieve
these exact immutable objects. It does not depend on the boutique-listing
application's `/api/images/*` proxy. The base remains configurable as
`MAIN_IMAGE_ASSET_PUBLIC_BASE_URL`.

This PR updates only RPagentOS configuration/contract documentation. It does not
change the boutique-listing code, delete or relocate existing objects, provision
a hostname, or deploy either application.

## 10. Mercari publish

RPagentOS:

1. Re-reads the exact listing.
2. Checks the expected content revision.
3. Checks the asset belongs to the same variant/listing context.
4. Acquires the shared listing publication claim from PR #77 so text and image
   publishes cannot race.
5. Builds the complete image order: new approved image first, existing images
   after it, exact duplicates removed.
6. Calls CatalogSync with exact shop/listing identity.
7. Requires marketplace identity and complete image-order readback.
8. On success, increments `content_revision`, updates canonical/observed images,
   marks the old quality score stale, updates `platform_listing_images`, stores
   the previous image order in `platform_listing_events`, and releases the claim.
9. On failure, releases the claim and leaves canonical images/revision unchanged.

Relay request:

```json
{
  "action": "listing-image-update",
  "dryRun": false,
  "payload": {
    "shopCode": "shop2",
    "listingId": "marketplace-listing-id",
    "imageUrls": [
      "https://assets.example/products/ITEM/main-images/ASSET/v1.png",
      "https://existing.example/image-2.jpg"
    ]
  }
}
```

Retry is the same idempotent publish request after the operator reloads current
state. No background job queue is needed.

## 11. Security

- Credentials stay server-side.
- Browser calls only the same-origin Inquiry BFF.
- BFF re-resolves exact listing identity before writes.
- Candidate bytes are bound to listing, revision, fact pack, schema, model,
  checksum, and expiry by an HMAC token; no arbitrary URL is accepted or
  fetched.
- Asset/listing relationship is checked before publication.
- R2 keys are immutable and checksummed.
- Listing revision and publication claim prevent concurrent text/image writes.
- Relay verifies exact shop, listing ID, and returned image order.
- Upstream bodies, tokens, and secrets are not returned to the browser.

## 12. Focused tests

Automated tests mock all external calls. The MVP test set covers:

- auth, configuration, methods, and unknown fields
- exact listing identity and stale revision
- exact `product_spu_id` traversal and exclusion of unrelated variants
- current title/description retained as context-only rather than trusted facts
- verified/context-only/conflicting fact classification and evidence IDs
- missing source image
- strict schema shape, bounded layout values, evidence validation, and mandatory
  restrictions
- rejection of unknown feature/keyword/variant/asset IDs and unsupported numeric
  claims
- fact-pack hash invalidation after source data changes
- exact-hash reuse of an approved fact-pack snapshot and forced re-review after
  any source-hash change
- operator confirmation/override persistence in asset metadata without mutation
  of canonical product tables
- one OpenAI image-edit candidate request using verified source images
- candidate-token signature/expiry/binding and explicit save confirmation
- type/size/dimension/checksum validation
- immutable R2 write and `product_assets` insert
- publish blocked without a matching saved asset
- exact relay payload and preserved image order
- relay identity/readback mismatch
- claim release after relay failure
- idempotent retry
- previous image order recorded for rollback
- no title/description mutation from image endpoints

### MVP schema-quality gate

Unit tests alone cannot establish generative quality. Before the PR is declared
ready for operator review, run a non-publishing eval against the real configured
OpenAI schema model using a small versioned set of representative SPUs. The eval
does not generate/persist marketplace assets and records no secrets.

Minimum gate:

- at least 10 representative SPUs, including single-variant, multi-color,
  multi-size/quantity, sparse-data, and conflicting-data cases
- 100% valid strict output shape
- 100% valid SPU/variant/source-asset/evidence references
- zero forbidden or unsupported claims accepted by server validation
- zero variation swatches mapped to another SPU or unlinked source image
- every missing/conflicting fact becomes an explicit warning or omission
- generated feature/keyword summary and schema are saved as an eval report for
  operator review; aesthetic usefulness is not claimed from automated scores

Prompt profile/version, model, fact-pack hash, output, validator result, and
operator feedback are retained in the report so prompt changes can be compared
against the same cases. This is a small quality fixture set, not a new workflow
table or production eval platform.

## 13. Delivery boundary

This delivery deploys the RPagentOS owner API, its R2 binding, immutable asset
delivery route, tests, and contract documentation.

Full operator use still requires two small coordinated follow-ups:

1. CatalogSync `listing-image-update` relay action.
2. Inquiry Portal image-specific BFF endpoints and workspace, stacked on PR #62.

The RPagentOS PR must not claim the end-to-end feature is production-ready until
those dependencies and runtime configuration exist.

## 14. Review questions

Please confirm before implementation:

Decisions already confirmed:

1. Use OpenAI by default with the server-side API key; generate exactly one
   candidate with `gpt-image-2`. There is no local-provider dependency or
   comparison mode in the MVP.
2. Publishing replaces position 1 and preserves all remaining images in order,
   removing only exact duplicates.
3. Preserve the complete previous image order for operator-assisted manual
   rollback; an interactive rollback button is a follow-up.
4. R2 decision: reuse and repurpose `boutique-listing-images-prod` with the
   separate `MAIN_IMAGE_ASSETS` binding and RPagentOS-owned immutable namespace.
   RPagentOS serves the namespace from its own immutable public delivery route.

Proposed resolution of the schema-quality review comment:

5. Schema generation is grounded in an evidence-tagged SPU fact pack. Current
   listing title/description supply feature and keyword leads, while canonical
   SPU/variant fields determine which claims are verified. Strict JSON shape,
   deterministic semantic validation, explicit operator confirmation, and a
   representative pre-PR eval gate are all required. The default schema model is
   `gpt-5.4`; changing it requires passing the same eval gate.
6. There is no generic canonical fact-pack table today. The MVP rebuilds the
   pack from canonical Supabase sources, allows optional operator
   confirm/exclude/edit controls during Schema Review, and stores the approved
   snapshot in `product_assets.metadata`. Exact source hashes may be reused;
   changed sources force regeneration and review. A standalone continuously
   maintained fact system remains out of scope until reuse demand is proven.

## 15. OpenAI references

- [Structured model outputs](https://developers.openai.com/api/docs/guides/structured-outputs/) — strict JSON Schema adherence
- [Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices/) — task-specific evals, representative data, and human judgment
- [Upgrading to GPT-5.4](https://developers.openai.com/api/docs/guides/upgrading-to-gpt-5p4/) — current `gpt-5.4` model string
- [Image generation](https://developers.openai.com/api/docs/guides/image-generation/) — Image API edit flow and image inputs
