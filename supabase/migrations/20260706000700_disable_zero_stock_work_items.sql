-- ============================================================================
-- Disable zero-stock listing work item generation
-- ============================================================================
--
-- Batch-listing strategy commonly leaves active marketplace SKUs at zero stock.
-- Those rows should remain source data, but they should not become operator work
-- items by default.

begin;

alter view if exists listing_target_classification_v1
  rename to listing_target_classification_v1_with_zero_stock;

create view listing_target_classification_v1 as
select *
from listing_target_classification_v1_with_zero_stock
where not (
  workflow_type = 'audit_existing_listing'
  and issue_type = 'price_stock_mismatch'
  and exists (
    select 1
    from jsonb_array_elements(classification_reasons) reason
    where reason ->> 'check' = 'zero_stock'
  )
);

grant select on listing_target_classification_v1 to authenticated;
grant select on listing_target_classification_v1 to service_role;

commit;
