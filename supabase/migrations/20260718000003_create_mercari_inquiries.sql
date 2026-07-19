-- Domain: product_catalog
-- Owner: retailpulses/RPagentOS
-- Affected: mercari_inquiries
-- Change class: additive
-- Hosted write required: yes
-- Consumers: retailpulses/skills:mercari-inquiry-follow-up
--
-- Replaces: Baserow table 886975 (Mercari Inquiries)
-- Migration: Baserow retirement — skills migrate to Supabase as source of truth

CREATE TABLE IF NOT EXISTS mercari_inquiries (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mercari_inquiry_id TEXT,
  shop TEXT NOT NULL CHECK (shop IN ('shop1', 'shop2', 'shop3', 'shop4')),
  customer_name TEXT,
  item_code TEXT,
  status TEXT DEFAULT 'open',
  last_message_at TIMESTAMPTZ,
  follow_up_sent_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE mercari_inquiries ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_mercari_inquiries_shop ON mercari_inquiries(shop);
CREATE INDEX IF NOT EXISTS idx_mercari_inquiries_status ON mercari_inquiries(status);
CREATE INDEX IF NOT EXISTS idx_mercari_inquiries_item_code ON mercari_inquiries(item_code);
CREATE INDEX IF NOT EXISTS idx_mercari_inquiries_mercari_inquiry_id ON mercari_inquiries(mercari_inquiry_id);
