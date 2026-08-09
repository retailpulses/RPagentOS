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

| Field | Declaration |
|---|---|
| Workload ID | `rakuten_copy_improvement_manual_canary` |
| Owner | `retailpulses/RPagentOS` |
| Domain | `listing_intelligence`, `listing_quality`, and `product_catalog` |
| Category | `agent_operations` |
| Risk | Medium |
| Trigger | Manual only |
| Access path | PostgREST for review/audit records; `internal_api` for canonical content application |
| Credential class | Server-side `service_role` for existing review tables; write-scoped internal API token for content application |
| Concurrency | 1 |
| Initial canary | One Rakuten listing in `dry_run`, followed by at most one listing in `approval` mode |
| Maximum batch | 10 after canary evidence is reviewed; hard code ceiling 20 |
| Maximum retries | One model repair; no automatic content-apply retry beyond idempotent replay |
| Request budget | 80 database/API requests per invocation; no more than 4,000 per 1,000 input listings |
| Write budget | At most 100 review/audit rows per invocation and at most one canonical listing row per approved canary application |
| Kill switch | Set `COPY_IMPROVEMENT_ENABLED=false` or force `COPY_APPLY_MODE=dry_run` |
| Rollback | Disable the kill switch; canonical content remains revisioned and the prior snapshot is retained for an operator-approved restoration |
| Approval evidence | User instruction “go build and make it live” in the Codex work session dated 2026-08-09 |

The canary must capture this-run requests, rows read, rows written, unchanged
writes, retries, errors, runtime, and content-score delta. Any critical error,
stale revision, unexpected protected-field change, request-budget breach, or
write-budget breach stops the run. Recurring activation requires registration
in the canonical database workload registry and a reviewed release commit.

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

- 46 focused listing-copy tests pass.
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

The two accepted proposals were directionally useful, but their reported
confidence values of 0.95 and 1.0 are not calibrated enough for automatic
application. The next quick-win iteration is to fix strict JSON response
handling and capture raw invalid output safely, then repeat a local 10-listing
dry run. Do not enable `auto` from the current 20% repaired-valid result.
