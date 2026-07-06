-- Reassert full unique indexes required by the product import upserts. Some
-- cloud databases had the original fix migration marked as applied after manual
-- dashboard work, but not all index changes were present.

drop index if exists ux_product_families_family_code;
alter table product_families alter column family_code set not null;
create unique index if not exists ux_product_families_family_code
  on product_families(family_code);

drop index if exists ux_product_variants_item_code;
alter table product_variants alter column item_code set not null;
create unique index if not exists ux_product_variants_item_code
  on product_variants(item_code);
