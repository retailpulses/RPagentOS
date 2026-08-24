# Rakuten Calendar-driven Coupon Templates — Feature Review

Status: Proposed for review  
Related issue: #82  
Scope: Rakuten Coupon only  
Initial campaign: `5と0のつく日`  
Out of scope: Amazon Coupon, Time Sale, Ads/Campaign execution, automatic publishing

## 1. Objective

Add calendar-driven coupon planning to the existing Promotion Planner so a shop manager can repeatedly prepare Rakuten store coupons around known Rakuten promotional dates.

The first supported rule is `5と0のつく日`: the 5th, 10th, 15th, 20th, 25th, and 30th of each month in `Asia/Tokyo`.

This feature creates reviewable coupon drafts. It does not make the store coupon an official Rakuten campaign coupon, and it must not describe the coupon as issued or sponsored by Rakuten. The official campaign rules may change, so each generated occurrence requires operator confirmation.

## 2. Product principles

1. Calendar dates, coupon strategy, and issued CouponAPI payloads are separate objects.
2. Generated plans are deterministic and idempotent.
3. A template version is frozen into each generated plan for auditability.
4. Draft generation never publishes a coupon.
5. `coupon.issue` always requires explicit human approval in the initial release.
6. Published coupons continue to follow Rakuten CouponAPI timing and mutation constraints.
7. All customer-facing wording must distinguish a store coupon from the official Rakuten points campaign.

## 3. Domain model

### 3.1 Calendar event definition

Defines when a relevant marketplace event is expected.

| Field | Initial value / meaning |
|---|---|
| `eventKey` | `rakuten_5_and_0_day` |
| `platform` | `rakuten` |
| `timezone` | `Asia/Tokyo` |
| `recurrence` | Day 5, 10, 15, 20, 25, and 30 of every month |
| `defaultStartTime` | `00:00:00` JST |
| `defaultEndTime` | `23:59:59` JST |
| `sourceUrl` | Official Rakuten campaign page |
| `requiresOperatorConfirmation` | `true` |
| `enabled` | Operator-controlled |

The generator must skip invalid dates, such as February 30. An occurrence is an internal planning signal, not proof that the official campaign will run under unchanged conditions.

### 3.2 Versioned coupon template

Defines reusable commercial intent and CouponAPI-compatible defaults without embedding a specific occurrence date.

Required metadata:

- `templateId`
- `templateVersion`
- `name`
- `eventKey`
- `shopCode`
- `status`: `draft`, `active`, or `retired`
- Coupon strategy and scope
- Default customer-facing copy
- Guardrails
- Creation and approval metadata

Editing an active template creates a new version. Existing generated plans retain the exact version and values from which they were created.

### 3.3 Event occurrence

Represents one expected calendar event, for example `2026-09-05` in JST.

Suggested fields:

- `eventKey`
- `occurrenceDate`
- `startsAt`
- `endsAt`
- `status`: `scheduled`, `confirmed`, `overridden`, `cancelled`, or `skipped`
- Official source verification timestamp and operator
- Optional date/time override and reason
- Conflict result

Occurrence status must remain separate from coupon plan status.

### 3.4 Generated coupon plan

Represents one future CouponAPI coupon or one member of a coupon bundle.

Idempotency key:

```text
shopCode + eventKey + occurrenceDate + templateId + templateVersion + bundleMemberKey
```

The same generation job may run repeatedly but must not create duplicate plans with the same idempotency key.

The plan stores:

- Frozen template snapshot
- Generated CouponAPI payload
- Validation and guardrail results
- Conflict decision and explanation
- Review/approval history
- Rakuten coupon code after issue
- API request/response audit references
- Verification result from `coupon.get`

## 4. Initial template catalog

Values below are review defaults, not approved commercial terms. Margin and inventory guardrails must pass before a plan can be approved.

### A. Storewide percentage coupon

Template key: `five_zero_storewide_percent`

- Whole-order/storewide scope
- `itemType: 4`
- `discountType: 2`
- Percentage configured per shop/template version
- `combineFlag: 0` by default
- `issueCount: 999999999` as the review default because CouponAPI requires a number; operator confirmation is required before issue
- Omits optional `memberAvailMaxCount`, device, purchase amount, purchase quantity, and member-rank restrictions
- Customer-facing shop name: `ホムブリス`

### B. Spend-tier bundle

Template key: `five_zero_spend_tier_bundle`

One occurrence generates multiple independent CouponAPI coupons, for example:

| Tier | Review default |
|---|---|
| Entry | ¥300 off orders of ¥5,000 or more |
| Growth | ¥700 off orders of ¥10,000 or more |
| Premium | ¥1,500 off orders of ¥20,000 or more |

Each tier is issued, verified, updated, and cancelled independently. The minimum-purchase condition uses CouponAPI condition code `RS003`. A partial bundle failure must be shown as partial failure, never as a successfully published bundle.

### C. Selected-item inventory coupon

Template key: `five_zero_selected_item_inventory`

- Selected item or item-group scope
- `itemType: 1` or `itemType: 3`, according to the selected targeting mode
- Uses Rakuten item URLs in `items[].itemUrl`
- Maximum 3,000 item URLs per coupon
- Requires stock and margin checks at approval time

## 5. CouponAPI payload alignment

Generated payloads must use the existing Rakuten coupon model and validator. Supported CouponAPI fields include:

- `couponName`
- `couponCaption`
- `couponStartDate`
- `couponEndDate`
- `couponImage`
- `issueCount`
- `itemType`
- `discountType`
- `discountFactor`
- `memberAvailMaxCount`
- `multiRankCond`
- `combineFlag`
- `displayFlag`
- `items[].itemUrl`
- `otherConditions`

Calendar and template metadata must not be added to the Rakuten payload. They remain internal Promotion Planner data.

## 6. Proposed workflow

| Timing | Action | External API effect |
|---|---|---|
| T-14 | Create future occurrence and flag it for confirmation | None |
| T-7 | Generate idempotent coupon draft(s) from active template version | None |
| T-3 | Complete commercial, conflict, copy, margin, and inventory review | None |
| T-1 | Approver authorizes publish, with more than 60 minutes remaining before start | None until confirmed |
| Publish | Call `coupon.issue` for each approved plan | Creates coupon |
| Immediately after issue | Call `coupon.get` and compare material fields | Read/verify |
| Before start minus 60 minutes | Full changes use the existing `coupon.update` review flow | Updates coupon |
| From start minus 60 minutes onward | Only `coupon.patch` for `displayFlag` is available | Display flag only |
| Cancellation | Separate approval, then `coupon.delete`, followed by verification | Deletes coupon |

Initial release must not automatically call `coupon.issue`, even when all validations pass.

### Coupon plan states

```text
scheduled
  -> draft_generated
  -> publish_review
  -> approved
  -> publishing
  -> published
```

Additional states:

- `update_review`
- `cancellation_review`
- `cancelled`
- `failed`
- `skipped_conflict`

Approval should expire if material inputs change after approval, including dates, discount, scope, conditions, issue count, or targeted items.

## 7. Guardrails and conflict rules

Before approval, the planner must check:

- Margin threshold for the proposed discount
- Current inventory for item-scoped coupons
- `issueCount` and per-member limit
- Coupon duration and Rakuten timing restrictions
- Required CouponAPI fields and valid field combinations
- Duplicate plans and existing RMS coupons for the same shop, period, and scope
- Customer wording and campaign attribution

Default conflict behavior:

1. Do not generate duplicate coupons for the same occurrence, shop, template version, bundle member, and scope.
2. A higher-priority event such as `Rakuten Super SALE` or `お買い物マラソン` may suppress or replace the normal `5と0のつく日` template when an approved priority rule exists.
3. Overlapping coupons default to `combineFlag: 0` unless an approver explicitly accepts another supported value.
4. A detected RMS coupon collision blocks publish review until the operator resolves or overrides it with a reason.
5. Every skipped or overridden plan records a human-readable reason.

No actual priority rules for Super SALE or お買い物マラソン are included in this first release; the model only provides an extension point.

## 8. Promotion Planner experience

Add three Rakuten views under `/promotions`:

### Calendar

- Monthly calendar in JST
- Marks all generated `5と0のつく日` occurrences
- Shows confirmation, conflict, and coupon-plan status
- Allows authorized users to confirm, skip, or override an occurrence with a reason
- Provides a link to the official campaign source

### Templates

- Template cards with version, status, coupon type, scope, discount defaults, and guardrails
- Preview of the CouponAPI-compatible values
- Create-new-version action instead of mutating an active version in place
- Retire action that does not alter existing plans

### Generated plans

- Filters by shop, occurrence, template, and lifecycle state
- Explains why each plan was generated, skipped, or blocked
- Shows the frozen template version
- Previews the exact proposed CouponAPI payload
- Clearly separates `Generate drafts`, `Approve`, and `Publish`
- Shows individual results for every coupon in a bundle

Amazon Coupon remains visible only as a future platform and is not included in template generation.

## 9. Roles and approval

Proposed minimum roles:

| Capability | Shop manager | Approver/admin |
|---|---:|---:|
| View calendar/templates/plans | Yes | Yes |
| Generate or regenerate draft plans | Yes | Yes |
| Edit draft commercial settings | Yes | Yes |
| Confirm/override official occurrence | No | Yes |
| Approve publish | No | Yes |
| Execute `coupon.issue` | No | Yes |
| Approve update/cancellation | No | Yes |

The implementation must use the application's existing authorization model; this proposal does not approve a new authentication or database design.

## 10. Acceptance criteria

1. The calendar produces the 5th, 10th, 15th, 20th, 25th, and 30th in JST for every selected month.
2. It does not generate nonexistent dates such as February 30.
3. Each occurrence requires confirmation or an explicit override before approval.
4. Draft generation uses an active, versioned template and freezes its version and resolved values.
5. Re-running generation is idempotent and does not duplicate plans.
6. A spend-tier bundle generates distinct coupon plans and reports partial failures accurately.
7. Conflict and higher-priority-event rules produce a visible decision and reason.
8. Generated payloads pass the existing Rakuten coupon model validation.
9. No `coupon.issue` call is possible without explicit approval.
10. A successful issue is not marked `published` until `coupon.get` verification succeeds.
11. Full updates are blocked inside Rakuten's 60-minute restriction window; only the supported `displayFlag` patch flow remains available.
12. Customer-facing copy never represents a store coupon as an official Rakuten-issued coupon.
13. The review prototype performs no database writes and no Rakuten API writes.
14. Amazon, Time Sale, and Ads/Campaign execution remain outside this feature's implementation scope.

## 11. Review decisions required

Before implementation, stakeholders should approve:

1. Which of the three initial templates should be enabled first.
2. Default discount, minimum-spend tiers, issue limits, and per-member limits for each shop.
3. Minimum margin thresholds and the source of margin/inventory data.
4. Whether the coupon window is the calendar day only or includes a lead-in/extension period.
5. Who may confirm occurrences, approve publishing, and approve cancellation.
6. How existing RMS coupon collisions should be detected and overridden.
7. The exact Japanese customer-facing naming and caption conventions.
8. The future priority order among `5と0のつく日`, Super SALE, and お買い物マラソン.

## 12. Suggested delivery phases

### Phase 1 — Review prototype

- Calendar preview for `5と0のつく日`
- Read-only template catalog
- Deterministic draft and payload preview
- No persistence and no API writes

### Phase 2 — Managed planning

- Persistent versioned templates, occurrences, generated plans, audit history, and role-based approvals
- Requires separate database-governance review before schema work

### Phase 3 — Controlled Rakuten execution

- `coupon.issue`, immediate `coupon.get` verification, update, patch, and cancellation flows
- Production credential and operational runbook review required

### Phase 4 — Broader promotion planning

- Additional Rakuten calendar events
- Time Sale and Ads/Campaign planning modules
- Amazon Coupon only after its independent API and workflow definition is approved

## 13. Source reference

- Rakuten official `5と0のつく日` campaign page: <https://event.rakuten.co.jp/card/pointday/>

The official source is informational and must be rechecked by an operator because marketplace schedules, eligibility, and campaign wording can change.
