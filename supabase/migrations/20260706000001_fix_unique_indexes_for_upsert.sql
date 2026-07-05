-- Fix: replace partial unique indexes with full unique indexes
-- so Postgres ON CONFLICT works for upsert operations.
-- All tables are currently empty (no data loss risk).

-- product_families: replace partial unique index with full index
drop index if exists ux_product_families_family_code;
alter table product_families alter column family_code set not null;
create unique index ux_product_families_family_code
  on product_families(family_code);

-- product_variants: replace partial unique index with full index
drop index if exists ux_product_variants_item_code;
alter table product_variants alter column item_code set not null;
create unique index ux_product_variants_item_code
  on product_variants(item_code);
