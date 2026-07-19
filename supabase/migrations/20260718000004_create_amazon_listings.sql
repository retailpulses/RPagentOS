-- Domain: product_catalog
-- Owner: retailpulses/RPagentOS
-- Affected: amazon_listings
-- Change class: additive
-- Hosted write required: yes
-- Consumers: retailpulses/skills:amazon-inventory-flatfile
--
-- Replaces: Baserow Amazon listings table
-- Migration: Baserow retirement — skills migrate to Supabase as source of truth

CREATE TABLE IF NOT EXISTS amazon_listings (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_code TEXT NOT NULL,
  asin TEXT,
  seller_sku TEXT,
  price INTEGER,
  quantity INTEGER,
  fulfillment_channel TEXT DEFAULT 'DEFAULT',
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_amazon_listings_item_code UNIQUE (item_code)
);

ALTER TABLE amazon_listings ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_amazon_listings_asin ON amazon_listings(asin);
CREATE INDEX IF NOT EXISTS idx_amazon_listings_seller_sku ON amazon_listings(seller_sku);
