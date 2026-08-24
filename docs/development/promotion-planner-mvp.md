# Promotion Planner MVP

Date: 2026-08-24  
Route: `/promotions`

## Goal

Give shop managers one place to plan promotions. The first implementation is
Rakuten CouponAPI-native. Amazon Coupon is the next marketplace implementation;
Time sale, Ads, and Campaign remain future promotion types.

## Current boundary

- Browser-only drafts using localStorage key `rpagentos.rakuten-coupon-plans.v2`.
- Calendar-driven `5と0のつく日` planning is enabled for August 2026. The
  system deterministically seeds the August 25 plan in `publish_review` and
  lets an operator generate other August occurrences without duplicates.
- The initial versioned template is an entire-order, store-only 5% discount
  with 100 issues, one use per member, no combination, and `displayFlag: 0`.
  These are review defaults and require operator confirmation of campaign
  timing, margin, copy, limits, and issue timing.
- No Supabase writes and no marketplace API calls.
- “Submit for publish review” changes only the local plan status.
- JSON export is available for review and downstream API-contract work.
- The exported DTO uses the verified Rakuten names `couponName`,
  `couponCaption`, `couponStartDate`, `couponEndDate`, `couponImage`,
  `issueCount`, `itemType`, `discountType`, `discountFactor`,
  `memberAvailMaxCount`, `multiRankCond`, `combineFlag`, `displayFlag`, `items`,
  and `otherConditions`.
- Amazon and Mercari are not selectable in the Rakuten Coupon form. Amazon
  Coupon will receive its own platform-native definition in the next phase.
- Advanced optional targeting fields whose current official enum/shape has not
  yet been captured locally (`purchaseHistoryCond`, gender, age range, birth
  month, and prefecture targeting) are intentionally not exposed. They must be
  added from the authenticated RMS field reference rather than approximated.

## Lifecycle mapping

| Planner state/action | Rakuten interface | Rule |
|---|---|---|
| Draft | none | Editable internal record; no RMS object exists. |
| Publish review | none | Human approval gate for the exact `coupon.issue` payload. |
| Publish | `coupon.issue` | Store returned `couponCode` and `pcGetUrl`, then verify with `coupon.get`. |
| Full update | `coupon.update` | Allowed only before the start-time-minus-60-minutes cutoff. |
| Visibility update | `coupon.patch` | At/after the cutoff, update `displayFlag` only. |
| Cancellation | `coupon.delete` | Requires approval and `couponCode`; verify after the call. |
| Reconciliation | `coupon.get` / `coupon.search` | RMS is authoritative for published coupons. |

`draft`, `publish_review`, and `cancellation_review` are internal workflow
states, not Rakuten statuses. The UI must never mark a coupon `published` until
`coupon.issue` returns successfully and read-after-write verification passes.

## Future data model

Use a generic plan plus typed channel payloads rather than putting every
platform field into one flat table:

```text
promotion_plans
  id, promotion_type, internal_name, status, schedule, owner, approval metadata
    -> promotion_plan_channels
       plan_id, platform, shop_code, channel_status, platform_payload
    -> promotion_plan_targets
       plan_id, target_type, target_ref
    -> promotion_plan_executions
       plan_id, platform, request snapshot, response snapshot, status
```

The server must remain the only holder of marketplace credentials. A future
Worker API should validate the common plan and then map it through separate
Rakuten, Amazon, and Mercari adapters. Planning, approval, and execution must
remain distinct actions.

## Production persistence gate

Before replacing browser storage with shared persistence:

1. Create an Issue proposing the new `product_catalog` objects and known consumers.
2. Add an additive migration in RPagentOS with access class and RLS declarations.
3. Put writes behind an authenticated Worker API; never expose `service_role`.
4. Add shop/account authorization and audit events.
5. Validate locally, then follow the hosted-write approval process.

Before enabling marketplace execution, add per-platform dry-run previews,
explicit human approval, idempotency keys, read-after-write verification,
kill switches, and bounded canaries. Rakuten has no sandbox, so its first live
canary must be hidden and strictly limited.
