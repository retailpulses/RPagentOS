-- Create product_image_links junction table for image↔variant linking.
-- Supports Level 1 dedup: one row per unique (product_spu_id, asset_url) in
-- product_assets, with variant/item_code linkage in the junction table.
--
-- Part of: https://github.com/retailpulses/RPagentOS/issues/3

create table if not exists product_image_links (
  id              uuid primary key default gen_random_uuid(),
  image_id        uuid references product_assets(id) on delete cascade not null,
  product_spu_id  uuid references product_spus(id) on delete cascade,
  variant_id      uuid references product_variants(id) on delete cascade,
  item_code       text not null,
  position        integer not null default 0,
  created_at      timestamptz default now()
);

-- Prevent duplicate links: same image + same variant + same position
create unique index if not exists uq_image_links_variant_pos
  on product_image_links(image_id, variant_id, position);

-- Fast lookup by image
create index if not exists ix_image_links_image
  on product_image_links(image_id);

-- Fast lookup by variant
create index if not exists ix_image_links_variant
  on product_image_links(variant_id);

-- Fast lookup by SPU
create index if not exists ix_image_links_spu
  on product_image_links(product_spu_id);

-- Fast lookup by item_code
create index if not exists ix_image_links_item_code
  on product_image_links(item_code);
