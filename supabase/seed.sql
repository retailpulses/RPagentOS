-- Seed data for local development only
-- Platform: mercari, Shop: shop4

insert into products (id, spu_code, title, category, status) values
  ('a0000000-0000-0000-0000-000000000001', 'SPU-TEST-001', 'テスト商品A', '家電・AV機器', 'active');

insert into product_variants (id, product_id, sku, variant_name, color, size_text, status) values
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'SKU-TEST-001-BLK', 'ブラック', 'ブラック', 'M', 'active');

insert into platform_listings (id, variant_id, platform, shop_code, external_listing_id, title, url, current_price, stock_qty, listing_status) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'mercari', 'shop4', 'listing-test-001', 'テスト商品A ブラック M', 'https://example.com/listing-test-001', 3500.00, 5, 'active');
