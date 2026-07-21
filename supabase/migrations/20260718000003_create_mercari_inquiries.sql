-- Domain: legacy inquiry compatibility (retired; formerly attributed to product_catalog)
-- Owner: retailpulses/RPagentOS
-- Affected: public.mercari_inquiries
-- Change class: retroactive baseline
-- Hosted write required: yes
-- Consumers: retailpulses/skills:mercari-inquiry-follow-up (superseded)
-- Related issue: retailpulses/inquiry-automation#35
--
-- This idempotent file records an object created before the coordinated
-- inquiry_management migration. It is retained only so migration history can
-- replay before the forward retirement migration.

CREATE TABLE IF NOT EXISTS public.mercari_inquiries (
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

ALTER TABLE public.mercari_inquiries ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_mercari_inquiries_shop
  ON public.mercari_inquiries(shop);
CREATE INDEX IF NOT EXISTS idx_mercari_inquiries_status
  ON public.mercari_inquiries(status);
CREATE INDEX IF NOT EXISTS idx_mercari_inquiries_item_code
  ON public.mercari_inquiries(item_code);
CREATE INDEX IF NOT EXISTS idx_mercari_inquiries_mercari_inquiry_id
  ON public.mercari_inquiries(mercari_inquiry_id);
