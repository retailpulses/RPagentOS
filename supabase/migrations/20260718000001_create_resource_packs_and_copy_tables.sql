-- Domain: product_catalog
-- Owner: retailpulses/RPagentOS
-- Affected: resource_packs, platform_copy_strategies, copywriting_outputs
-- Change class: additive
-- Hosted write required: yes
-- Consumers: retailpulses/skills:giga-resource-pack-copywriting
--
-- Replaces: Baserow tables 912520 (Resource Packs), 912423 (Platform Copy Strategies), 912536 (Copy Outputs)
-- Migration: Baserow retirement — skills migrate to Supabase as source of truth

-- Resource Packs (GigaB2B item-code-indexed pack data)
CREATE TABLE IF NOT EXISTS resource_packs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_code TEXT NOT NULL,
  pack_data JSONB DEFAULT '{}'::jsonb,
  source_import_run_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_resource_packs_item_code UNIQUE (item_code)
);

-- Platform Copy Strategies (Rakuten, Amazon, Mercari)
CREATE TABLE IF NOT EXISTS platform_copy_strategies (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('rakuten', 'amazon', 'mercari')),
  strategy_name TEXT NOT NULL,
  strategy_config JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Copywriting Outputs
CREATE TABLE IF NOT EXISTS copywriting_outputs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_code TEXT NOT NULL,
  platform TEXT NOT NULL,
  copy_text TEXT,
  strategy_id BIGINT REFERENCES platform_copy_strategies(id) ON DELETE SET NULL,
  generated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS: worker_only access class (service_role bypass)
ALTER TABLE resource_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_copy_strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE copywriting_outputs ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_resource_packs_item_code ON resource_packs(item_code);
CREATE INDEX IF NOT EXISTS idx_copywriting_outputs_item_code ON copywriting_outputs(item_code);
CREATE INDEX IF NOT EXISTS idx_copywriting_outputs_platform ON copywriting_outputs(platform);
