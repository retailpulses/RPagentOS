# AI Listing Copy Improvement Loop

## Purpose

Improve weak Rakuten or Mercari listing titles and descriptions with a local
LLM, apply safe suggestions, and verify that the resulting listing is better.

```text
Select listing
  -> generate improved copy
  -> validate automatically
  -> optionally request operator approval
  -> save the approved or auto-approved copy
  -> re-score the listing
```

## Design principles

1. **Operator approval is optional.** Safe, fully validated changes may be
   applied automatically. Risky or uncertain changes are routed to an
   operator.
2. **Start with quick wins.** The first version changes only the listing title
   and description.
3. **The LLM proposes; deterministic checks decide whether the proposal is
   safe.** Price, stock, identity, and other operational fields remain outside
   the model's control.
4. **Every change is traceable and revision-safe.** A stale proposal must never
   overwrite newer listing content.
5. **Measure improvement.** Re-score the listing after application and record
   the before/after result.

## MVP scope

The first version supports:

- Rakuten titles and descriptions first
- Mercari titles and descriptions after the Rakuten flow is stable
- Manual selection or simple rule-based selection
- One local-LLM suggestion per listing
- Deterministic validation
- Configurable auto-apply, approval, and dry-run modes
- Canonical Supabase content updates
- Before/after quality-score measurement

The first version does **not** include:

- Image creation or replacement
- Price or inventory changes
- Category or attribute changes
- Direct publication to Rakuten or Mercari
- Marketplace performance analytics
- Automatic rollback

## Loop stages

### 1. Select listings

A listing is eligible when at least one condition is true:

- The title is missing or unusually short.
- The description is missing or unusually short.
- The deterministic content score is below a configured threshold.
- An operator manually selects the listing.

The job should process a bounded batch, initially 10 to 20 listings per run.
Unchanged listings should not be processed repeatedly.

### 2. Build a grounded input package

Give the local LLM only trusted listing and product information:

- Existing title and description
- Canonical product title
- Material, color, and size
- Verified dimensions and weight
- Country of origin
- Relevant listing attributes
- Marketplace and shop
- Current deterministic quality issues

The model must not invent or modify:

- Price or stock
- Shipping promises
- Warranty terms
- Performance claims
- Rankings such as “No. 1” or “best”
- Unverified specifications or dimensions

### 3. Generate one suggestion

Generate one structured proposal rather than multiple alternatives:

```json
{
  "suggested_title": "...",
  "suggested_description": "...",
  "change_summary": "...",
  "confidence": 0.87,
  "requires_approval": false
}
```

Store the proposal and its provenance in the existing
`listing_qwen_reviews` flow, including the model, prompt version, source
snapshot hash, and validation result.

### 4. Validate deterministically

Before a proposal can be applied, verify:

- The response is valid JSON with the required fields.
- Title and description respect marketplace length limits.
- Numeric facts are present in trusted source data.
- The copy contains no unsupported or prohibited claims.
- Product identifiers are unchanged.
- Price, stock, shipping, and category are untouched.
- The proposal is materially different from the current copy.
- The listing content revision still matches the reviewed revision.

Allow one automatic repair attempt for invalid model output. If validation
still fails, mark the proposal failed and leave the listing unchanged.

### 5. Decide whether approval is required

Approval behavior is controlled by a simple runtime mode:

```text
COPY_APPLY_MODE=dry_run | auto | approval
```

- `dry_run`: generate and validate proposals without applying them.
- `auto`: automatically apply safe proposals and route exceptions to review.
- `approval`: require operator approval for every proposal.

In `auto` mode, a proposal may be applied automatically only when:

- All deterministic validation passes.
- Confidence meets the configured threshold.
- Only the title or description changes.
- All factual statements are grounded in trusted product data.
- The listing revision has not changed.
- The target shop is explicitly enabled for automatic application.

Require operator approval when:

- Confidence is below the threshold.
- A new claim or numeric specification appears.
- The listing is a hero product.
- The proposed change is unusually large.
- The model recommends a change outside the MVP scope.
- The shop is configured for approval mode.

Operator approval is therefore an exception-handling and policy option, not a
mandatory stage for every listing.

### 6. Apply safely

For the MVP, application means updating the canonical Supabase listing through
the existing revision-checked listing lifecycle endpoint.

Record:

- `content_origin = ai_enhanced`
- Local model name
- Prompt version
- Idempotency key
- Expected and resulting content revisions
- Application timestamp

The first version must not publish directly to Rakuten or Mercari. Existing
marketplace-specific CSV or API workflows remain responsible for production
publication.

### 7. Re-score and measure

After applying a proposal:

1. Capture a new immutable listing snapshot.
2. Run the deterministic quality review again.
3. Compare the new result with the baseline.
4. Record the score delta in the existing listing-quality cycle.

Minimum run metrics:

- Listings selected and processed
- Valid and invalid proposals
- Auto-applied proposals
- Proposals awaiting approval
- Operator approvals and rejections
- Average content-score change
- Count improved, unchanged, and worsened
- Runtime, retries, and errors

A worse result should be flagged for review. Automatic rollback is deliberately
deferred until the loop has enough operating evidence.

## Minimal implementation

Implement one bounded CLI job:

```bash
npm run job:listing:improve-copy -- \
  --platform=rakuten \
  --limit=10 \
  --mode=dry-run
```

The job should reuse:

- Listing review snapshots
- The local Qwen/Ollama adapter
- Existing source-fact and claim validation
- `listing_qwen_reviews`
- The revision-checked listing content update endpoint
- The deterministic score engine
- `listing_quality_cycles`

No new table is required for the first version. The quick win is connecting
the existing proposal, validation, optional approval, safe update, and
re-scoring components.

## Recommended rollout

1. Run Rakuten in `dry_run` mode on 10 curated listings.
2. Review validation failures and generated-copy quality.
3. Run in `approval` mode on a small Rakuten batch.
4. Enable `auto` only for high-confidence, fully grounded changes in one shop.
5. Add Mercari after two healthy Rakuten cycles.

Production activation remains subject to the repository's database workload
governance, kill-switch, observability, and hosted-write approval requirements.

## Proposed build plan

This plan deliberately favors a small working loop over a generalized listing
optimization framework. Estimated implementation time is four to six focused
engineering days, excluding production rollout approval.

### Decisions to confirm before implementation

The proposed MVP defaults are:

- Rakuten only for the first pilot
- Title and description only
- `dry_run` as the default mode
- Maximum 10 listings per first run
- Existing local Ollama/Qwen model and review storage
- No new database table
- No direct Rakuten or Mercari publication
- Automatic application allowed only for low-risk, fully validated proposals
- Operator approval required only by policy or when a proposal is uncertain
- Quality-score delta is the MVP outcome metric

### Phase 1: Define the loop contract and fixtures

**Goal:** establish one stable input, output, and safety contract before adding
orchestration.

Build:

- A `CopyImprovementProposal` TypeScript contract.
- A trusted-facts assembler that loads the listing, canonical product facts,
  relevant attributes, and current quality findings in bulk.
- A Rakuten copy prompt profile with a version identifier.
- Local fixtures for strong, weak, incomplete, and unsafe listings.

Keep the implementation compact. Prefer one listing-copy package with small,
testable functions rather than a new framework or many abstraction layers.

Acceptance checks:

- Trusted facts can be assembled without per-record database lookups inside a
  loop.
- Prompt input contains no credentials or unnecessary raw payload fields.
- Output is strict JSON and can be parsed into the proposal contract.

### Phase 2: Build proposal generation and validation

**Goal:** generate useful Rakuten title and description proposals without
changing canonical listing content.

Build:

- A local-Qwen proposal function using the existing Ollama configuration.
- Reuse of the existing Qwen run/review provenance where practical.
- Deterministic validation for required fields, marketplace length rules,
  unsupported numeric facts, prohibited claims, and unchanged protected fields.
- One repair attempt for invalid model output.
- Idempotent reuse based on listing snapshot, model, and prompt version.
- A bounded CLI entrypoint:

  ```bash
  npm run job:listing:improve-copy -- \
    --platform=rakuten \
    --limit=10 \
    --mode=dry_run
  ```

`dry_run` means that `platform_listings` is not changed. Proposal and run
records may still be persisted for review and audit. A local fixture-only run
must be available when a strictly zero-database-write test is required.

Acceptance checks:

- A batch cannot exceed its configured limit.
- Invalid or unsafe proposals are persisted as failed/invalid and are never
  eligible for application.
- Re-running the same snapshot does not create a new valid proposal by default.

### Phase 3: Add the optional approval decision

**Goal:** support both fast automatic application and operator-controlled
application without building two separate workflows.

Build one decision function with three modes:

- `dry_run`: never apply listing content.
- `approval`: mark valid proposals `ready_for_review` and wait.
- `auto`: apply proposals that pass the automatic-application policy; route all
  other valid proposals to `ready_for_review`.

The automatic-application policy must require:

- Successful deterministic validation
- Confidence at or above the configured threshold
- No hero-product flag
- No new unsupported claim or specification
- Only title and/or description changes
- Matching source and current content revisions
- An explicit shop-level auto-apply allowlist

Use existing listing work-item statuses where possible:

```text
open -> ready_for_review -> approved -> closed
```

Do not introduce a new approval table for the MVP. An approved proposal can be
resumed by proposal ID or by an `--apply-approved` job option.

Acceptance checks:

- Approval mode never applies an unapproved proposal.
- Auto mode routes policy exceptions to review instead of failing the batch.
- Rejected or stale proposals cannot be applied later.

### Phase 4: Apply canonical content safely

**Goal:** update only the canonical Supabase title and description, using the
existing listing lifecycle protections.

Build:

- An apply adapter for the revision-checked internal listing content endpoint.
- A deterministic idempotency key derived from listing ID, source revision,
  proposal output hash, model, and prompt version.
- Persistence of `content_origin = ai_enhanced`, model, prompt version, and
  enhancement timestamp through the existing lifecycle contract.
- Clear handling for applied, replayed, stale, protected, and failed outcomes.

The apply step must not update marketplace listings directly and must not write
price, stock, shipping, category, attributes, or SKU identity.

Acceptance checks:

- A concurrent or newer listing revision produces a stale result and no write.
- Retrying a successful apply is idempotent.
- A batch failure does not cause already-safe items to be applied twice.

### Phase 5: Close the measurement loop

**Goal:** determine whether the accepted copy improved the listing-quality
result.

Build:

- A new immutable snapshot after successful application.
- A deterministic re-review of the changed listing.
- Baseline, latest score, and score delta updates through the existing quality
  cycle.
- A run summary separating current-run results from historical issues.

Required summary metrics:

- Selected, proposed, valid, invalid, and failed
- Auto-applied and awaiting approval
- Approved, rejected, stale, and replayed
- Improved, unchanged, and worsened
- Average content-score delta
- Database/API requests, rows read, rows written, retries, and runtime

Acceptance checks:

- Every applied proposal has either a completed re-review or an explicit
  measurement failure.
- A worse result is flagged for review and is not silently treated as success.

### Phase 6: Pilot and harden

Run the rollout in this order:

1. Local fixture run with no database writes.
2. Rakuten `dry_run` on 10 curated listings.
3. Rakuten `approval` mode on a small batch.
4. Two healthy approval-mode cycles.
5. `auto` mode for one explicitly allowlisted Rakuten shop and only low-risk
   proposals.
6. Evaluate Mercari as a separate follow-up after the Rakuten pilot.

The runtime kill switch is to disable the job or force
`COPY_APPLY_MODE=dry_run`. Recurring or production database operation must be
declared and approved under the database workload governance before activation.

## Global OpenCode agent support

Implementation may use the repository-approved global OpenCode worker through
`rp-opencode-worker`.

Suggested delegation:

- **Flash worker:** repository exploration, existing-function mapping, fixture
  and test-case generation, documentation checks, and repetitive analysis.
- **Pro worker:** bounded implementation after this plan is confirmed, such as
  the proposal/validation package or CLI orchestration, with explicit file and
  acceptance boundaries.
- **Root Codex agent:** architecture, security and credential decisions,
  database/schema decisions, production changes, final diff review, validation,
  and final delivery.

After every worker run, the root agent will verify provider/model metadata,
inspect the result and diff, independently check important claims, and run the
relevant tests. Workers will not receive credentials, access production data,
approve schema changes, deploy, or make release decisions.

## Definition of Done for confirmation

The MVP is done when all items below are satisfied.

### Functional behavior

- [ ] A CLI can select a bounded batch of Rakuten listings by listing ID or
  simple quality rules.
- [ ] The local LLM returns one structured title/description proposal per
  eligible listing.
- [ ] Each proposal records its listing snapshot, model, prompt version, input
  hash, output hash, validation status, and confidence.
- [ ] `dry_run`, `approval`, and `auto` modes behave as documented.
- [ ] Operator approval is optional in `auto` mode and mandatory in `approval`
  mode.
- [ ] Valid approved or auto-approved proposals update only canonical title and
  description.
- [ ] The MVP performs no direct Rakuten or Mercari publication.

### Safety and correctness

- [ ] Unsupported numeric facts and prohibited claims are blocked.
- [ ] Price, stock, shipping, category, attributes, SKU identity, and product
  identity cannot be changed by this loop.
- [ ] Hero listings and uncertain proposals are routed to operator review.
- [ ] Automatic application is limited to explicitly allowlisted shops.
- [ ] Revision checks prevent stale proposals from overwriting newer content.
- [ ] Application is idempotent and safe to retry.
- [ ] Invalid, rejected, protected, and stale proposals cannot be applied.
- [ ] No credentials, service-role keys, or unnecessary raw source data appear
  in prompts, logs, or committed fixtures.

### Measurement and operations

- [ ] Every applied proposal triggers a new snapshot and deterministic
  re-review.
- [ ] The quality cycle records baseline score, latest score, and score delta.
- [ ] The run report includes proposal, approval, application, measurement,
  request, row, retry, error, and runtime metrics.
- [ ] The kill switch and `dry_run` fallback are documented and tested.
- [ ] Current-run health is reported separately from historical repository
  debt.

### Engineering quality

- [ ] Unit tests cover proposal parsing, fact grounding, prohibited claims,
  approval policy, revision conflicts, idempotent replay, and mode behavior.
- [ ] Integration tests cover one successful apply, one approval-required
  proposal, one invalid proposal, and one stale-revision rejection.
- [ ] Type checking and all tests relevant to the changed files pass.
- [ ] The implementation uses bounded/bulk reads and introduces no N+1
  database or API pattern.
- [ ] No unrelated files or existing user changes are modified.
- [ ] The runbook contains exact commands for fixture, dry-run, approval, auto,
  resume-approved, and rollback/escalation procedures.

### Production activation gate

Code completion does not itself authorize production activation. Before a
recurring or hosted-write run is enabled:

- [ ] The workload is declared or registered as required by governance.
- [ ] Hosted-write approval is recorded.
- [ ] The kill switch and monitoring thresholds are confirmed.
- [ ] A bounded dry-run report is reviewed.
- [ ] The initial shop allowlist and confidence threshold are explicitly
  approved.

## One-off manual canary workload declaration

This work brief declares the first bounded production canary. It does not
authorize a recurring or scheduled workload.

| Field             | Declaration                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Workload ID       | `rakuten_copy_improvement_manual_canary`                                                                                            |
| Owner             | `retailpulses/RPagentOS`                                                                                                            |
| Domain            | `listing_intelligence`, `listing_quality`, and `product_catalog`                                                                |
| Category          | `agent_operations`                                                                                                                  |
| Risk              | Medium                                                                                                                                |
| Trigger           | Manual only                                                                                                                           |
| Access path       | PostgREST for review/audit records;`internal_api` for canonical content application                                                 |
| Credential class  | Server-side`service_role` for existing review tables; write-scoped internal API token for content application                       |
| Concurrency       | 1                                                                                                                                     |
| Initial canary    | One Rakuten listing in`dry_run`, followed by at most one listing in `approval` mode                                               |
| Maximum batch     | 10 after canary evidence is reviewed; hard code ceiling 20                                                                            |
| Maximum retries   | One model repair; no automatic content-apply retry beyond idempotent replay                                                           |
| Request budget    | 140 database/API requests per invocation; no more than 4,000 per 1,000 input listings                                                 |
| Write budget      | At most 220 benchmark/review/audit rows per invocation and at most one canonical listing row per approved canary application          |
| Kill switch       | Set`COPY_IMPROVEMENT_ENABLED=false` or force `COPY_APPLY_MODE=dry_run`                                                            |
| Rollback          | Disable the kill switch; canonical content remains revisioned and the prior snapshot is retained for an operator-approved restoration |
| Approval evidence | User instruction “go build and make it live” in the Codex work session dated 2026-08-09                                             |

The canary must capture this-run requests, rows read, rows written, unchanged
writes, retries, errors, runtime, and content-score delta. Any critical error,
stale revision, unexpected protected-field change, request-budget breach, or
write-budget breach stops the run. Recurring activation requires registration
in the canonical database workload registry and a reviewed release commit.

## Benchmark-grounded copywriting loop (v2 design)

The first canaries showed that structural validity is not evidence of commercial
quality. A proposal must no longer be called an improvement merely because it
is valid JSON, within a length limit, or different from the current copy.

The v2 loop adds a fixed, versioned category benchmark before copy generation:

```text
Resolve listing category and segment
  -> resolve an operator-designated benchmark when supplied
  -> otherwise derive a deterministic category/segment scope
  -> reuse its active automatic benchmark when no more than 30 days old
  -> when absent/stale, capture and quality-check Rakuten leaders
  -> persist and atomically activate the new frozen scope target
  -> load the frozen target profile and supporting Rakuten listings
  -> generate grounded copy with DeepSeek
  -> validate claims against canonical trusted facts only
  -> compare before and proposal against the same benchmark version
  -> optionally approve/apply
  -> measure marketplace outcomes
```

### Benchmark operating policy

- Operator designation is supported but optional. `--benchmark-set-id` pins a
  run to that active set and disables automatic replacement for the run.
- Without a pin, the loop derives a deterministic scope from trusted product
  title, category, and segment traits such as seat count, size, power mode,
  intended use, and material. Listings with the same scope share one capture.
- An active operator benchmark does not expire automatically. An active
  automatic benchmark is reused for 30 days by default; an absent or stale
  target triggers identification as part of the normal loop. Configure this
  with `COPY_BENCHMARK_TTL_DAYS`.
- Atomic activation also rejects an automatic set that would replace an active
  operator-designated target for the same scope.
- Automatic identification accepts a result set only when it has at least 5
  non-sponsored items, 3 distinct shops, and 70% scope relevance. Capture is
  sequential with a one-second inter-scope delay by default, configurable via
  `COPY_BENCHMARK_CAPTURE_DELAY_MS`.
- A benchmark set is immutable evidence for one evaluation cycle. Changing the
  target creates and activates a new version; the previous version is retired.
- Activation is atomic. At most one benchmark is active for an exact
  marketplace/category/scope key.
- Automatic capture is a bounded, transparent Rakuten search-page request. It
  captures at most 10 non-sponsored results from the first page, observed rank,
  title, URL, shop, price, rating, and review count when available.
- The standalone capture command defaults to a zero-write JSON preview.
  Persistence and activation are explicit there. In the copy loop itself,
  successful automatic identification is persisted and activated so every
  proposal in the scope uses the same fixed target. Operator designation
  changes `selection_mode` to `operator`; otherwise it remains `automatic`.
- Competitor copy is stored as benchmark evidence but is not trusted product
  evidence and is not supplied verbatim to the copy model. The prompt receives
  only the frozen aggregate target profile.
- Top placement is market evidence, not proof of copy quality. Advertising,
  price, reviews, seller strength, and promotions may affect rank. Sponsored
  items are excluded and promotional/navigation terms are excluded from the
  automatic title profile.
- Search capture v1 benchmarks titles only. Description benchmarking is marked
  unavailable rather than fabricated. Category-specific description topics
  may be added to a later benchmark version from reviewed product-page,
  customer-inquiry, review, return, and conversion evidence.

The additive Supabase objects are:

- `listing_copy_benchmark_sets` — category, version, selection mode, capture
  method, frozen target profile, lifecycle status, and content hash.
- `listing_copy_benchmark_items` — the captured non-sponsored listings and
  their observation evidence.
- `activate_listing_copy_benchmark_set(uuid)` — atomic retirement of the old
  target and activation of the new target.

### Model policy

- Copywriting provider default: `deepseek`.
- Copywriting model default: `deepseek-chat`.
- Overrides remain `LISTING_COPY_PROVIDER` and `LISTING_COPY_MODEL`.
- Copy settings do not select the image-analysis model. Existing image review
  remains on its separately configured local Qwen path using
  `LISTING_IMAGE_MODEL` (default `qwen3.5:9b`, with the legacy
  `LISTING_QWEN_MODEL` fallback). The long-term image-model decision remains a
  separate evaluation.

### SPU parent-child assortment policy

- Benchmark scope is resolved from the verified SPU assortment, not from one
  child listing title. Suitcases preserve exact verified sizes such as
  `Sサイズ`; generic `サイズ` is not a valid segment.
- The loop loads all child variants for the selected SPU in one bounded bulk
  read and records whether the offer is single-size or multi-size.
- Rakuten leaders that combine S/M/L are recorded as market-structure evidence.
  They do not authorize unavailable sizes in our copy.
- A single-size SPU may learn title structure from multi-size leaders but its
  proposal must state only its verified size. A verified multi-size SPU may
  generate a shared parent description and size comparison from child facts.

### Improvement and safety gates

A benchmarked proposal is valid only when:

- current title/description are treated as copy to audit, not factual proof;
- numeric and sensitive commercial claims are present in canonical trusted
  facts, not merely in the old listing or a competitor listing;
- it improves the score against the exact frozen benchmark version;
- title or description benchmark coverage does not regress;
- it does not share a distinctive long passage with a benchmark listing; and
- normal protected-field, revision, allowlist, and approval rules still pass.

Automatic application additionally requires a positive benchmark evaluation
and a benchmark containing both title and description targets. The current
search-capture v1 has no description target and therefore cannot auto-apply.
Missing or incomplete benchmark coverage routes a proposal away from
auto-apply; operator involvement in choosing the benchmark remains optional.

Capture preview:

```bash
npm run job:listing:capture-copy-benchmark -- \
  --query='電動リクライニングソファ 2人掛け' \
  --category-id=566180 \
  --category-name='電動リクライニングソファ' \
  --limit=10
```

Persistence and optional activation require the migration and approved
server-side Supabase environment:

```bash
npm run job:listing:capture-copy-benchmark -- \
  --query='電動リクライニングソファ 2人掛け' \
  --category-id=566180 \
  --category-name='電動リクライニングソファ' \
  --limit=10 --persist --activate

# Add --operator-designated only when an operator intentionally chose the set.
```

### v2 canary definition

The comparison canary must reuse the same 10 listing IDs as the prior DeepSeek
run, run in `dry_run`, record a benchmark-resolution event per listing, and
report:

- benchmark ID/version or explicit missing status;
- before/proposed benchmark score and delta;
- title and description coverage before/after;
- claim-grounding, regression, and copy-overlap failures;
- exact before/proposed title and description;
- runtime, model, prompt version, requests, rows read, and audit rows written.
- benchmark reuse, stale, identified, failed-identification, external capture,
  and benchmark-row-write counts.

No canonical listing or marketplace content may change during this canary.

### v2 implementation and canary status — 2026-08-11

- The additive benchmark migration, capture preview/persistence command,
  benchmark resolver, prompt v2, deterministic benchmark evaluator, and
  DeepSeek copy defaults are implemented in the current worktree.
- Root TypeScript passes and 69 focused copy/benchmark tests pass.
- A live zero-write Rakuten preview for
  `電動リクライニングソファ 2人掛け` captured 10 non-sponsored results with
  rank, title, shop, price, rating, and review-count evidence.
- The preview showed that broad category rankings contain promotion noise and
  adjacent product segments. Automatic profile generation now excludes common
  promotion/navigation terms and seeds the target with the explicit query.
- Search capture v1 remains title-only. It cannot authorize auto-apply because
  it has no description benchmark.
- The same-10 DeepSeek proposal canary was attempted in `dry_run` and stopped
  before database access because `SUPABASE_URL` was not available in the
  current runtime. No benchmark, audit, canonical, or marketplace row was
  written by that attempt.

### SPU suitcase canary — 2026-08-11

- Canary listing `80f9ccfa-c772-4d24-94a5-3e1ee80b302d` resolves through
  `product_platform_links` to parent SKU `PP298906`.
- Canonical data defines this as an S-size SPU with 14 child variants. It has no
  trusted product-family link to the separate M/L SPUs, so the loop does not
  fabricate an S/M/L parent offer.
- Automatic scope `suitcase:single-size:s:e93b8660fd0cf16c` captured and froze
  10 relevant Rakuten leaders from 9 shops. Seven of the ten leaders advertise
  multiple sizes, recorded as market-structure evidence only.
- Prompt v3 loads the SPU assortment in one bulk read, preserves verified size,
  excludes empty attribute keys and sibling marketing names from claim evidence,
  and uses a bounded 1,800-token DeepSeek response.
- Final review `d679fe6b-688f-45af-95ba-e29572c0d865` failed closed because
  `キャスター`, `エンボス加工`, and `メッシュポケット` lacked canonical
  evidence and the proposal did not improve the fixed benchmark score.
- The active benchmark is `d47d00d9-9388-4218-923a-732814041fff`, version 1.
  No canonical listing or marketplace content changed; content revision remains 1.
- Root TypeScript and 73 focused copy/benchmark tests pass.
- The migration has not been applied to hosted Supabase from this worktree.
  Hosted migration prerequisites and runtime credentials are required before
  the same-10 proposal canary can execute.

## Implementation and live status

Implemented and released on 2026-08-09 in commit `36e3bbb`.

Available commands:

```bash
# Proposal-only run; canonical listing content is not changed
npm run job:listing:improve-copy -- \
  --mode=dry_run --platform=rakuten --limit=10

# Route valid proposals to ready_for_review
COPY_IMPROVEMENT_ENABLED=true \
npm run job:listing:improve-copy -- \
  --mode=approval --platform=rakuten --limit=10

# Apply only proposals an operator already marked approved
COPY_IMPROVEMENT_ENABLED=true \
npm run job:listing:improve-copy -- \
  --apply-approved --platform=rakuten --limit=10

# Auto mode remains fail-closed without an explicit shop allowlist
COPY_IMPROVEMENT_ENABLED=true \
COPY_IMPROVEMENT_AUTO_SHOPS=homebliss \
npm run job:listing:improve-copy -- \
  --mode=auto --platform=rakuten --shop-code=homebliss --limit=1
```

Release evidence:

- 48 focused listing-copy tests pass.
- 144 internal catalog API tests pass.
- Root and web TypeScript checks pass.
- Production web build passes.
- Real local `qwen3.5:9b` smoke returned a valid grounded title and description
  without a repair attempt.
- GitHub internal API verification run `31311617973` passed.
- Cloudflare Pages deployment run `31311617980` passed.
- `https://agent.homesbliss.net` returned HTTP 200 after deployment.
- The protected content-update endpoint returned HTTP 401 without a bearer
  token, confirming that the deployed apply boundary remains authenticated.

The code and protected apply API are live. Automatic execution and recurring
scheduling remain disabled.

GitHub Actions run `31312834322` exercised the hosted credential and database
path, but its CPU-only `qwen3.5:4b` result is infrastructure evidence only. It
must not be used to judge the intended local-Qwen product loop.

The first production-data canary on the intended local M1 Pro runtime used
`qwen3.5:9b`. One listing completed in 87.735 seconds versus 391.230 seconds for
the hosted 4B listing step. It was rejected because the response remained
non-JSON after one repair attempt. No canonical content changed.

A subsequent local 10-listing learning batch ran from commit `4565a75` with
manual bulk selection and per-listing validation evidence:

- Runtime: 1,126.163 seconds (18 minutes 46 seconds)
- Requests: 52; rows read: 550
- Results: 2 repaired-valid, 8 invalid, 0 runtime failures
- First-pass valid: 0; every accepted proposal required the repair pass
- Rejections: 7 non-JSON responses and 1 unsourced numeric fact (`115cm`)
- Audit writes: 30 new immutable run/result/review rows
- Canonical listing writes: 0; automatic application remained disabled

The two accepted Qwen proposals were directionally useful, but their reported
confidence values of 0.95 and 1.0 are not calibrated enough for automatic
application.

The same deterministic 10 listings were then processed through the direct
DeepSeek API using `deepseek-chat` and the same prompt, repair pass, validators,
and dry-run persistence:

- Runtime: 40.435 seconds, about 27.9 times faster than local Qwen 9B
- Requests: 52; rows read: 550
- Results: 5 first-pass valid, 5 invalid, 0 runtime failures
- Structural reliability: 10/10 valid JSON responses; no JSON repair failures
- Rejections: all 5 correctly declined to make a material change after repair
- Groundedness: zero unsourced numeric facts and zero prohibited claims detected
- Audit writes: 30 new immutable run/result/review rows
- Canonical listing writes: 0; automatic application remained disabled

DeepSeek is the stronger candidate for the quick learning loop: it produced
usable structured output on every listing and five grounded improvements on the
first pass. The remaining quick wins are to record token usage and API cost,
calibrate confidence, and select genuinely weak listings instead of merely the
newest listings. Do not enable `auto` until those checks and an operator review
of accepted copy are complete.

## Appendix: DeepSeek 10-listing canary proposals for review

These are the five proposals that passed the current deterministic validator.
They were generated on 2026-08-09 and were **not applied** to canonical listings
or published to Rakuten. Text below is preserved from the model output. The
review flags are additional human-review prompts, not validator findings.

### 1. Electric lawn mower

- Review ID: `2bdf2c9e-dcbe-4cf5-b401-d4d8d4f05be2`
- Confidence: `0.95`
- Proposed title: 草刈り機 電動 コンセント式 13kg 刈幅38cm 刈高20〜70mm 6段階調整 50L集草バッグ付き 折りたたみ ハンドル3段階調節 グレー
- Rationale: タイトルは主要キーワードを整理し、文字数を削減しつつ検索に強い構成に改善。説明文は既存の内容を整理し、禁止表現を排除し、事実に基づいた情報を簡潔にまとめた。
- Review flags: verify `100V`, no-assembly status, country of origin, Japanese-spec/quality claims, environmental claims, grounding requirement, and demographic ease-of-use claims.

<details>
<summary>Proposed description</summary>

家庭用の芝生や庭の草刈りに最適なコンセント式電動草刈機です。超軽量13kgで女性や高齢者の方でも簡単に操作でき、折りたたみ機構により収納時も場所を取りません。コンセント式なので充電切れの心配がなく、排気ガスも出さず環境にも優しい設計です。

【特長】

・超軽量13kg：軽量設計で持ち運びや方向転換が楽々。女性や力の弱い方でもストレスなく草刈り作業が行えます。

・コンセント式：家庭用100V電源に接続するだけですぐに使用可能。充電切れの心配がなく、長時間の連続作業も安心。排気ガスゼロで環境にも優しい。

・折りたたみ収納：工具不要で簡単に折りたためる。使わない時はコンパクトに収納でき、ガレージや物置のスペースを有効活用できます。

・刈幅38cm・刈高6段階調整：ワイドな刈幅で効率よく芝刈りができ、20mm〜70mmまで6段階に高さ調節可能。芝生の状態や好みに合わせて最適な長さにカットできます。

・50L大容量集草バッグ：たっぷり入る集草袋で刈った草をまとめて回収。作業後の掃除が簡単で、満タンが分かるお知らせ窓付きで便利です。

【仕様】

カラー：グレー
重量：約13kg
組立：不要
原産国：中国

【おすすめの使用シーン】

・家庭の芝生の定期的な手入れに
・庭の雑草が気になる場所の草刈りに
・小さな畑や菜園の周りの草刈りにも

【品質・お手入れについて】

当製品は厳しい品質基準をクリアした安心の日本仕様です。ご使用後は本体の汚れを柔らかい布で拭き取り、湿気の少ない場所で保管してください。刃の部分は定期的に点検し、必要に応じて交換してください。電源コードは必ずアース付きコンセントに接続し、水や湿気の多い場所での使用は避けてください。安全のため、お子様の手の届かない場所で保管し、使用時は保護メガネや手袋の着用をおすすめします。

</details>

### 2. System loft bed

- Review ID: `aa0c4b73-5d66-4bab-bc8a-a1878cc381e9`
- Confidence: `0.90`
- Proposed title: システムベッド ロフトベッド シングル デスク付き コンセント付き 収納付き ハンガーポール付き 耐荷重150kg 北欧風 スチール 耐震 ホワイト
- Proposed description: no change (`null`)//original description is "null"? or porposed description is "null"?
- Rationale: The current title is already concise, search-optimized, and includes key features. The description is detailed and informative, with no prohibited claims. No material improvement is needed.
- Review flags: the rationale says no material improvement is needed even though a title change was proposed; verify `耐荷重150kg` and `耐震` against source evidence.

### 3. Electric reclining sofa

- Review ID: `dc36b539-452f-4fda-926b-1fa03fbf95c5`
- Confidence: `0.90`
- Proposed title: 電動リクライニングソファ 2人掛け 左右独立 150° オットマン一体型 グレー ファブリック 耐圧分散 完成品 //seems too short for me
- Rationale: タイトルを簡潔にし、検索されやすいキーワードを維持しつつ、文字数を削減。説明文は既存の内容を整理し、禁止表現を含まないことを確認。
- Review flags: verify all dimensions, weight, materials, country of origin, Japanese-planned quality claim, and the claim that prolonged sitting is less tiring.

<details>
<summary>Proposed description</summary>

//proposed description toobrief for a high-price item to me

電動リクライニングソファ 2人掛け 左右独立 150° オットマン一体型 グレー ファブリック 耐圧分散 完成品

二人それぞれ好みの角度に。電動で楽々、オットマン一体型の快適ソファ。

本製品は、左右それぞれ独立して電動リクライニングが可能な2人掛けソファです。オットマンが一体型となっており、足を伸ばしてリラックスしたい方に最適。リビングや書斎など、お二人でくつろぎたい空間におすすめです。

商品の特長

【左右独立電動リクライニング】お二人それぞれが好みの角度に調節可能。最大150°までリクライニングでき、読書や映画鑑賞、仮眠などシーンに合わせて最適な姿勢を実現します。

【オットマン一体型】足を伸ばしてリラックスできるオットマンがソファと一体化。別途オットマンを用意する必要がなく、スペースを有効活用できます。

【耐圧分散構造】体圧を分散する設計で、長時間座っても疲れにくい。座面と背もたれのクッション性が高く、快適な座り心地を提供します。

商品仕様

カラー: グレー
素材: ファブリック（張地）、ウレタンフォーム（クッション）、スチール（フレーム）
寸法: 幅約140cm × 奥行約85cm × 高さ約100cm（リクライニング時：奥行約150cm）
重量: 約45kg
組立: 不要（完成品）
原産国: 中国

おすすめの使用シーン

・リビングでの家族団らんや映画鑑賞に
・書斎や寝室での読書や仮眠に
・高齢の方や足を上げたい方のリラックスチェアとして

品質・お手入れについて

当製品は厳しい品質基準をクリアした安心の日本企画品です。お手入れは、柔らかい布で乾拭きするか、中性洗剤を薄めた水で湿らせた布を固く絞って拭き、その後乾拭きしてください。直射日光や高温多湿の場所を避けてご使用ください。電動リクライニング機能は定格使用を守り、無理な力を加えないでください。

</details>

### 4. Twelve-person valuables locker

- Review ID: `c4d58493-1e3d-4b40-bffb-f6063c309650`
- Confidence: `0.90`
- Proposed title: 貴重品ロッカー 12人用 スチール製 ダイヤル錠 管理キー付き 完成品 ホワイト オフィス 学校 更衣室 業務用 セキュリティキャビネット 日本語説明書付き
- Rationale: タイトルは「小型」を削除し、主要キーワードを維持しつつ簡潔にしました。説明文は既存の内容から不要なHTMLタグや重複を省き、簡潔で読みやすくしました。禁止表現は含まれていません。
- Review flags: verify the distinction between 管理キー and マスターキー, the Japanese manual, material/durability claims, and suitability statements.

<details>
<summary>Proposed description</summary>

12人分の貴重品を安全に収納できるスチール製ロッカーです。各扉にはダイヤル錠が付いており、利用者自身で施錠・開錠が可能。さらに管理者用のマスターキーが付属するため、緊急時や清掃時にも安心です。スチール素材を使用し、耐久性に優れています。組み立て不要の完成品でお届けするため、開梱後すぐにご使用いただけます。オフィスや学校、更衣室などでの使用に最適です。

</details>

### 5. Inflatable pool with slide

- Review ID: `ba6c46b4-42a0-4a9a-bd6c-4d56650cdbe3`
- Confidence: `0.90`
- Proposed title: 大型エアープール 滑り台付き ビニールプール マルチカラー 電動ブロワー付き 室内外兼用 折りたたみ収納
- Rationale: タイトルは「ビニールプール」を「マルチカラー」の前に移動し、主要キーワードを前方に配置して検索最適化を図りました。説明文は既存の内容を整理し、HTMLタグを除去してプレーンテキストに変換し、読みやすくしました。事実に基づき、禁止表現は含まれていません。
- Review flags: verify one-minute inflation, included bag, material, dimensions, weight, PSE certification, safety-standard and double-stitch claims, and the 30kg usage limit.

<details>
<summary>Proposed description</summary>

電動ブロワー付きで約1分で膨らむ大型エアープールです。滑り台が付いており、水遊びやボール遊びを存分に楽しめます。室内でも屋外でも使用でき、折りたたんでコンパクトに収納できます。

【おすすめポイント】

・電動ブロワー付き：コンセントに繋ぐだけで約1分で膨らみ、準備が簡単。遊び終わったら空気を抜いてコンパクトに収納できます。

・滑り台付き大型プール：ウォータースライダーとしても使える滑り台と、広々としたプールが一体型。水を流せば本格的なウォータースライダーに。

・室内外兼用・折りたたみ収納：広めのリビングでも使えるサイズで、天候を気にせず遊べます。専用バッグ付きで持ち運びも楽々。

【商品詳細】

カラー：マルチカラー
素材：厚手オックスフォード布（PVCコーティング）
サイズ：約 (幅)200cm × (奥行)150cm × (高さ)80cm（膨らませた状態）
重量：約 5kg（本体＋ブロワー）
組立：不要（ブロワーで膨らませるだけ）
原産国：中国

【おすすめの使用シーン】

・夏の庭先での水遊びやウォータースライダーとして
・雨の日や暑い日の室内遊び（リビングなど広いスペースで）
・お友達を呼んでの誕生日会やホームパーティー

【品質・お手入れについて】

本製品は厳しい安全基準をクリアしており、PSEマークを取得しております。お子様が安全に遊べるよう、丈夫な素材とダブルステッチ縫製を採用しております。

お手入れ方法：使用後は柔らかい布で拭き取り、十分に乾燥させてから収納してください。水遊び後はカビ防止のため、必ず乾燥させてください。

ご注意：お子様だけで使用させず、必ず保護者の目の届く範囲でご使用ください。体重30kg以上のお子様や大人の使用はお控えください。尖ったものや火気の近くでの使用は避けてください。

</details>

## Appendix: SPU1 claim-pack canary — 2026-08-11

### Purpose

Test whether a deterministic SPU1 claim pack can prevent DeepSeek from treating the current Rakuten copy or benchmark competitors as product evidence. This was a one-listing `dry_run`; canonical and marketplace content application were disabled.

### Canary identity

- Listing ID: `80f9ccfa-c772-4d24-94a5-3e1ee80b302d`
- SPU1: `PP298906`
- Internal SPU ID: `4b4e17fc-05f1-4631-9b4e-7c81b1886192`
- Frozen benchmark: `d47d00d9-9388-4218-923a-732814041fff`, version 1
- Benchmark scope: `suitcase:single-size:s:e93b8660fd0cf16c`
- Model: `deepseek-chat`
- Final prompt version: `v5`
- Final review ID: `8a6e1c32-84d4-433c-a544-7213951f8014`

### Preparation implemented

- The model now receives `verified_claim_pack`, not broad raw Supabase rows.
- The current listing title and description remain visible only as copy to rewrite; they are not claim evidence.
- Competitor benchmark data remains structural market evidence only.
- Empty listing attributes, sibling marketing names, and unsupported feature labels are excluded from affirmative evidence.
- A parent listing with multiple equally confident variant links no longer selects an arbitrary child. For this listing, `selectedVariant` is empty and only facts common across all 14 SPU1 children are exposed.
- `2日3日` is normalized deterministically to `2～3日`.
- A safe explicit no-op is allowed when verified facts cannot improve the frozen benchmark.

### Final verified claim pack

```json
{
  "parentSpu": {
    "spuCode": "PP298906",
    "productTypes": ["スーツケース", "キャリーケース", "キャリーバッグ"],
    "sizes": ["S"],
    "tripDuration": "2～3日",
    "features": ["TSAロック"]
  },
  "selectedVariant": { "itemCode": null },
  "commonAcrossChildren": {
    "weightKg": 2.7,
    "packageQuantity": 1,
    "countryOfOrigin": "中国",
    "assemblyStatus": "要組立品"
  },
  "assortment": { "strategy": "single_size", "childCount": 14, "sizes": ["S"] }
}
```

Explicitly unsupported or missing: 機内持ち込み, 360度キャスター, エンボス加工, メッシュポケット, lightness claims, color, and M/L availability.

### Before and proposed after

Current title:

> スーツケース Sサイズ 超軽量 TSAロック搭載 ベージュ 小型 キャリーバッグ 2日3日旅行 おしゃれ エンボス加工 軽量 1個

DeepSeek v5 proposed title:

> スーツケース Sサイズ TSAロック搭載 キャリーケース キャリーバッグ 2～3日旅行 1個

DeepSeek v5 proposed description:

> スーツケース（Sサイズ）です。TSAロック搭載で、鍵付きの荷物を預ける際に便利です。2～3日の旅行に適したサイズです。重量は約2.7kg、パッケージは1個、原産国は中国、組立が必要です。

### Result

- Validation: `invalid` after one repair
- Benchmark score: 55 before, 55 proposed, delta 0
- Benchmark reused: 1
- Benchmark external requests: 0
- Benchmark rows written: 0
- Auto-applied: 0
- Canonical listing revision: still 1
- Marketplace/canonical copy changed: no

The v5 copy is materially cleaner than the previous canary: it removed unsupported color, material, lightness, caster, embossing, and pocket claims. It still did not meet the fixed benchmark improvement rule. It also embellished the verified `TSAロック` label into an unsupported use-benefit statement ("鍵付きの荷物を預ける際に便利"), showing that exact-field prompts and keyword validators alone do not fully govern sentence-level inference.

### Learning and next gate

Do not expand or apply this loop yet. The next quick-win gate should be sentence-level claim attribution: every factual sentence or benefit must cite one or more claim-pack IDs, and deterministic validation must reject text that cannot be traced to those claims. Category benchmark scoring must also reward removal of unsupported claims, not only keyword/topic coverage; otherwise a safer rewrite can remain score-neutral and be rejected. Finally, `要組立品` should be business-verified for this suitcase category before it is surfaced to shoppers, even though it is currently common across the canonical SPU children.

## Appendix: Enforced claim attribution canary — 2026-08-11

### Iteration change

Prompt v6 no longer asks DeepSeek to write factual title or description sentences. DeepSeek selects ordered IDs from an allowlisted claim catalog. RPagentOS then renders the exact shopper-facing fragments and records an attribution for every rendered claim. Unknown IDs, title-ineligible IDs, duplicate IDs, altered rendered text, or mismatched attributions are rejected deterministically.

Benchmark evaluation now combines category coverage with an unsupported-claim cleanup penalty. Removing unsupported claims can therefore improve the score even when safe canonical facts cannot add another benchmark keyword or description topic.

The suitcase `要組立品` value was traced across all 14 SPU1 children and two completed import runs. Both runs used the same source file and identical file hash, so they are repetition rather than independent corroboration. The suitcase claim catalog now quarantines this value and does not make it renderable.

### Final v6 canary

- Listing ID: `80f9ccfa-c772-4d24-94a5-3e1ee80b302d`
- SPU1: `PP298906`
- Frozen benchmark: `d47d00d9-9388-4218-923a-732814041fff`, version 1
- Model: `deepseek-chat`
- Prompt: `v6`
- Review ID: `e2c585b4-0d5b-4fdc-945a-4bca1f398a78`
- Validation: `valid`
- Repair attempts: 0
- Benchmark score: 15 before, 55 proposed, delta +40
- Unsupported claim groups: 9 before, 0 proposed, 9 removed
- Benchmark title coverage: 55 before and proposed
- Benchmark description coverage: 0 before and proposed
- Benchmark reused: 1
- Benchmark external requests: 0
- Benchmark rows written: 0
- Auto-applied: 0
- Canonical listing revision: still 1

### DeepSeek claim selection

Title IDs:

```text
parent.product_types
parent.sizes
parent.trip_duration
parent.feature.tsa_lock
common_across_children.weight_kg
```

Description IDs:

```text
parent.product_types
parent.sizes
parent.trip_duration
parent.feature.tsa_lock
common_across_children.weight_kg
common_across_children.package_quantity
common_across_children.country_of_origin
```

### Deterministically rendered proposal

Title:

> スーツケース キャリーケース キャリーバッグ Sサイズ 2～3日旅行 TSAロック搭載 2.7kg

Description:

> スーツケース（キャリーケース／キャリーバッグ）です。
>
> サイズはSです。
>
> 旅行目安は2～3日です。
>
> TSAロックを搭載しています。
>
> 重量は2.7kgです。
>
> 内容数は1個です。
>
> 原産国は中国です。

### Learning and next gate

This iteration closes the observed fabrication path: DeepSeek cannot add TSA-lock benefits, colors, materials, lightness, caster features, or other prose because it does not control factual rendering. The proposal is safe but intentionally plain, and benchmark description-topic coverage remains zero because the canonical source does not contain the corresponding category evidence.

The next iteration should improve conversion usefulness without weakening grounding: add category-specific, evidence-backed claim templates only after canonical fields exist for dimensions, capacity, material, wheel/caster construction, interior organization, and carry-on eligibility. A bounded 10-listing dry-run can now test claim availability and no-op rates, but marketplace application should remain disabled until those results are reviewed.

## Appendix: Evidence-first commercial canary — 2026-08-12

### Strategy correction

The v6 score mixed two different questions. Removing unsupported claims raised the score from 15 to 55 even though fixed-benchmark commercial coverage stayed 55 to 55. That was a safety improvement, not a commercial improvement.

The loop now treats them separately:

1. **Commercial score:** category decision completeness 40%, Rakuten title/search quality 25%, differentiation/persuasion 20%, readability/structure 15%.
2. **Claim safety:** hard pass/fail gate for invented objective product facts and prohibited or regulated claims. Generic, non-quantified benefits such as `安心`, `スムーズ`, `便利`, `整理しやすい`, `軽量`, and `大容量` are commercially evaluated rather than evidence-gated.

Benchmark leaders define the category decision factors and title priorities. They never prove that this product has a feature. Product-master consensus and supplier assets are the product-truth sources.

### Enriched evidence used

This remained a one-listing dry run. The frozen benchmark and SPU identity were unchanged. No listing content was applied.

- `product_variants.raw_payload`, common across all 14 SPU children: ABS+PC, external dimensions approximately 56 × 37 × 24 cm after orientation normalization, weight approximately 2.7 kg, and origin China.
- Supplier image position 7: S external dimensions approximately 56 × 37 × 24 cm including handles/casters; internal dimensions approximately 50 × 35 × 23.5 cm; capacity approximately 41.1 L; travel guideline 1–3 nights.
- Supplier image position 4: TSA dial lock, 50 mm 360-degree caster, and three-stage S-size carry bar.
- Supplier image position 3: cross straps and mesh pocket.
- Supplier image position 2: ABS+PC shell and embossed finish.
- Supplier image position 5: S size has no side handle or bottom feet.

The canary excluded color because the parent listing spans variants. It also excluded carry-on eligibility, quiet casters, durability, scratch resistance, broad lightness claims, and the suspicious assembly value.

### Out-of-box generation test

The initial review incorrectly treated generic benefits such as `安心`, `スムーズ`, `整理しやすい`, and `便利` as unsupported factual claims. That was too strict and commercially counterproductive. The corrected policy allows this language while continuing to verify every objective feature behind it.

A fresh four-candidate DeepSeek run under the corrected policy produced two passes and two failures. The failures invented objective TSA inspection mechanics such as `鍵を壊さずに検査が可能` or `セキュリティチェックが可能`. The two passing candidates used generic benefits but did not invent a hard feature. This is the intended boundary: `TSAロックで海外旅行も安心` may compete on copy quality, while a specific unverified description of how airport inspection works is blocked.

DeepSeek can therefore control natural copy and merchandising emphasis. RPagentOS evidence-gates numbers, materials, colors, components, mechanisms, certifications, eligibility, included items, and named technical performance such as quiet casters. Generic benefits are scored, not blocked.

### Selected enriched DeepSeek proposal

Title:

> 【軽量】Sサイズ キャリーケース 1～3泊 41.1L 2.7kg TSAロック 360度回転キャスター 3段階キャリーバー

Description:

> 軽量2.7kgで持ち運び楽々、Sサイズながら41.1Lの大容量。1～3泊の出張や旅行にぴったりです。外寸は56×37×24cm、内寸は50×35×23.5cm。ABS+PC混合樹脂素材にエンボス加工を施し、傷や汚れに強い仕上がり。直径50mmの360度回転キャスターで、どんな方向にもスムーズに移動。3段階調節可能なキャリーバーで、シーンに合わせて長さを調整できます。TSAロック付きで、海外旅行も安心。内部はクロスベルトとメッシュポケットで荷物をしっかり固定し、整理しやすくなっています。※側面ハンドル・底足はありません。

### Comparison

The scores below use the new commercial rubric. Safety is shown separately and never contributes points.

| Version | Safety gate | Decision completeness /40 | Title/search /25 | Differentiation /20 | Readability /15 | Commercial total /100 | Outcome |
|---|---:|---:|---:|---:|---:|---:|---|
| Current Rakuten copy | **Fail** | 28 | 18 | 16 | 3 | 65 | Reject: numerous unsupported claims and poor readability |
| v6 deterministic proposal | Pass | 16 | 18 | 5 | 12 | 51 | Safe but commercially weaker than current copy |
| Selected enriched DeepSeek proposal | Pass | 40 | 23 | 16 | 15 | **94** | Canary winner; eligible for operator review, not applied |

The result validates the out-of-box move. Evidence enrichment creates the commercial headroom that v6 lacked. A narrow hard-fact gate prevents fabrication without flattening useful commercial language.

### Next implementation gate

Implement provenance-aware enriched facts in the normal pipeline, with source kind, field or asset reference, SPU/variant applicability, and confidence. DeepSeek may author natural copy, but every objective hard fact must resolve to that evidence pack. Keep commercial scoring separate from the binary hard-fact safety gate, then repeat this same fixed-listing canary before expanding to 10 listings.

## Appendix: Generic-category profile canary — 2026-08-12

### Purpose and implementation

Test whether the evidence-first loop can operate without a suitcase-specific category template. `generic-v1` now:

- derives product identity and searchable terms from the canonical SPU;
- creates provenance-bearing facts only from values common across the variants linked to the listing, falling back to all SPU children only when the listing has no variant links;
- supports generic evidence kinds: identity, variant, dimensions, weight, material, component, feature, origin, assembly, quantity, and specification;
- allows DeepSeek to write natural commercial copy and generic benefits;
- requires declared hard-claim evidence IDs and a separate DeepSeek hard-claim audit;
- applies deterministic prohibited-claim and numeric-fact checks;
- scores decision completeness, title/search quality, differentiation, and readability separately from safety.

No schema change was made. The canary job performs four bulk PostgREST reads and avoids per-listing database queries. It writes only a local report artifact.

### Fixed random sample

- Seed: `generic-v1-2026-08-12`
- Marketplace: Rakuten
- Sample frame: 100 recently updated draft/enhanced listings with product links
- Selected: five listings after deterministic seeded shuffle
- Model: `deepseek-chat`
- Database requests: 4
- Rows read: 700
- LLM requests: 10
- Marketplace/database writes: 0

The five products were deliberately heterogeneous despite unreliable category metadata: a steel rack, reclining single-seat sofa, electric reclining bed, pet drying box, and M-size suitcase. Three unrelated products carried category ID `301577`, demonstrating that the generic profile cannot depend on current category IDs alone.

### Results

| Product | Before commercial score | Proposed score | Delta | Hard-feature gate | Main learning |
|---|---:|---:|---:|---|---|
| Steel rack | 38 | 29 | -9 | Fail | Proposed color was not authorized at listing-linked variant scope; title keyword coverage also regressed |
| Reclining sofa | 40 | 49 | +9 | Fail | Copy improved structurally, but numeric/assembly wording exceeded normalized evidence |
| Electric reclining bed | 28 | 33 | +5 | Fail | Several dimensions, weight, color, and tool-free assembly were not available as normalized listing-scope facts |
| Pet drying box | 33 | 66 | +33 | Fail | Strongest commercial gain, but the model added an unsupported completed/no-assembly claim |
| M-size suitcase | 54 | 60 | +6 | Fail | Commercially better, but the model added unverified adjustment/TSA-mechanism wording |

Summary:

- Commercially improved: 4/5
- Median commercial delta: +6
- Passed hard-feature gate: 0/5
- Applied: 0/5

### Interpretation

The architecture is portable, but the current generic evidence adapter is not yet strong enough for category-independent acceptance. The canary did not fail because soft benefits such as `安心`, `スムーズ`, `便利`, `軽量`, or `大容量` were blocked. It failed because objective facts copied or inferred from current listing prose were missing from the first-party evidence pack at the correct listing/variant scope.

Two generic defects were identified and patched after the first report:

1. evidence now uses variants actually linked to the listing before falling back to every SPU child;
2. structured numeric evidence now normalizes values such as `90.00` to shopper wording such as `90cm` and captures numeric-unit aliases from supplier text.

Generic soft-benefit-only audit findings are also explicitly excluded from the blocking gate. Objective color, dimensions, components, assembly mode, TSA mechanics, certifications, eligibility, and similar hard facts remain gated.

### Next gate

Do not expand generic auto-acceptance yet. Add one constrained repair pass that removes only unsupported hard facts while preserving the commercial structure, then repeat this exact five-listing seed. The target is at least 3/5 safety passes with positive commercial delta. Category-specific profiles should remain optional accelerators for better benchmarks and scoring, not prerequisites for the generic loop.

## Appendix: Deterministic hard-fact repair canary — 2026-08-12

### Iteration change

The generic pipeline now converts validator and audit findings into four objective issue types—unsourced numeric fact, unsupported hard fact, prohibited claim, and unsupported audited hard claim—then performs deterministic text repair:

- remove only the title token containing the unsupported fact;
- remove the smallest comma-delimited clause or sentence containing it from the description;
- never target generic soft benefits;
- re-run deterministic validation after repair;
- require both a safety pass and positive commercial-score delta for eligibility.

This is deletion logic, not an LLM rewrite. DeepSeek supplies the initial commercial structure and identifies possible objective claims; RPagentOS controls the final removal and pass decision.

### Same fixed five-listing rerun

- Seed: `generic-v1-2026-08-12`
- Same listing IDs: yes
- Database requests: 4 bulk reads
- Rows read: 700
- DeepSeek requests: 10
- Runtime: 16.2 seconds
- Database/marketplace writes: 0

| Product | Repair | Safety after repair | Commercial delta | Eligible |
|---|---|---:|---:|---:|
| Steel rack | Removed unsupported listing-scope green color | Pass | -9 | No |
| Reclining sofa | No hard-fact removal required; generic `組立簡単` remained allowed | Pass | +9 | **Yes** |
| Electric reclining bed | Removed unsupported color, dimensions, and tool-free assembly clauses | Pass | +5 | **Yes** |
| Pet drying box | Removed unsupported `組立不要（完成品）` | Pass | +33 | **Yes** |
| M-size suitcase | Removed unsupported TSA inspection-mechanism and carry-bar adjustment clauses | Pass | 0 | No |

Result:

- Hard-feature safety passed: 5/5
- Positive commercial delta: 3/5
- Final eligible proposals: 3/5
- Soft-benefit removals: 0
- Applied: 0

This meets the iteration target of at least three safe, commercially improved proposals. The acceptance rule prevents a safe but commercially regressive repair from proceeding.
