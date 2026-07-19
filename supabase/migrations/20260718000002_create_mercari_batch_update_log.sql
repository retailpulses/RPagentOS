-- Domain: product_catalog
-- Owner: retailpulses/RPagentOS
-- Affected: mercari_batch_update_log
-- Change class: additive
-- Hosted write required: yes
-- Consumers: retailpulses/skills:mercari-batch-update
--
-- Replaces: Baserow table 938452 (Mercari Batch Update tracking)
-- Migration: Baserow retirement — skills migrate to Supabase as source of truth

CREATE TABLE IF NOT EXISTS mercari_batch_update_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  listing_id TEXT NOT NULL,
  shop TEXT NOT NULL CHECK (shop IN ('shop1', 'shop2', 'shop3', 'shop4')),
  update_type TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  success BOOLEAN DEFAULT false,
  error_message TEXT,
  run_id UUID,
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE mercari_batch_update_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_mercari_batch_update_log_listing_id
  ON mercari_batch_update_log(listing_id);
CREATE INDEX IF NOT EXISTS idx_mercari_batch_update_log_shop
  ON mercari_batch_update_log(shop);
CREATE INDEX IF NOT EXISTS idx_mercari_batch_update_log_created_at
  ON mercari_batch_update_log(created_at);
