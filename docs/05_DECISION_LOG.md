# Decision Log

## 2026-07-18 — Adopt Baserow Mercari pricing formula as PostgreSQL trigger

### Context

During the sync-giga-saved-products → mercari-csv-listing pipeline migration from Baserow
to Supabase, the Mercari listing CSV was priced at cost (unit_price + shipping_fee) with
zero margin. The correct Baserow 886994 production formula has 6 computed fields:
Effective Cost Price → Effective TCOGS → Prcing COE → RMA Multiple → Mercari excl → incl,
with 24% Mercari fee coverage (/0.76 divisor) and ¥50 rounding.

The formula was deployed directly to production via psycopg2 on 2026-07-15 (governance
incident retailpulses/rp-governance-kit#32). This migration retroactively creates the
canonical migration file in the owning repository.

### Decision

Implemented as a PostgreSQL BEFORE INSERT/UPDATE trigger on product_commercials so that:
- `effective_cost_price` and `mercari_effective_price_incl_shipping` are recomputed
  automatically whenever source columns (source_unit_price, fulfillment_fee, baseline_price,
  discounted_unit_price, manual_cost_price, rma_rate) change.
- The formula is enforced at the database level, not in application code — consistent with
  how compute_effective_cost_price was already implemented.

### Impact

- 253 of 5,823 rows in product_commercials have pricing (only freshly synced GigaB2B rows
  have fulfillment_fee data)
- Trigger is idempotent (CREATE OR REPLACE / DROP IF EXISTS)
- No breaking changes to existing consumers

### Follow-up

- After merge: supabase db push to register migration in hosted ledger
- Verify zero drift with supabase db diff
- Consider adding compute_mercari_qty as a trigger when the qty formula parity issue is resolved

## YYYY-MM-DD — Decision title

### Context

### Decision

### Impact

### Follow-up
