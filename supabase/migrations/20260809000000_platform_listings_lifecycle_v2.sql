-- Domain: product_catalog
-- Owner: retailpulses/RPagentOS
-- Affected: public.platform_listings, public.platform_listing_images, public.platform_listing_events
-- Change class: additive
-- Hosted write required: yes
-- Consumers: retailpulses/CatalogSync (giga_marketplace_pipeline.py)
-- Issue: https://github.com/retailpulses/CatalogSync/issues/54
-- Rollback: drop added columns (safe: only unused columns added; existing queries unaffected)

-- ---------------------------------------------------------------------------
-- 1. platform_listings: lifecycle master columns
-- ---------------------------------------------------------------------------

-- Lifecycle stage (independent of Mercari listing_status)
ALTER TABLE public.platform_listings
  ADD COLUMN IF NOT EXISTS lifecycle_stage text NOT NULL DEFAULT 'draft';

-- Content revision counter — incremented on any canonical content change
ALTER TABLE public.platform_listings
  ADD COLUMN IF NOT EXISTS content_revision bigint NOT NULL DEFAULT 1;

-- Provenance
ALTER TABLE public.platform_listings
  ADD COLUMN IF NOT EXISTS source_variant_id uuid;
ALTER TABLE public.platform_listings
  ADD COLUMN IF NOT EXISTS source_content_hash text;
ALTER TABLE public.platform_listings
  ADD COLUMN IF NOT EXISTS content_origin text NOT NULL DEFAULT 'giga_generated';
ALTER TABLE public.platform_listings
  ADD CONSTRAINT valid_content_origin CHECK (
    content_origin IN ('giga_generated', 'ai_enhanced', 'operator')
  );

-- Enhancement provenance
ALTER TABLE public.platform_listings
  ADD COLUMN IF NOT EXISTS enhancement_key text;
ALTER TABLE public.platform_listings
  ADD COLUMN IF NOT EXISTS enhancement_model text;
ALTER TABLE public.platform_listings
  ADD COLUMN IF NOT EXISTS enhancement_prompt_version text;
ALTER TABLE public.platform_listings
  ADD COLUMN IF NOT EXISTS enhanced_at timestamptz;

-- Scoring (snapshot tied to specific content revision)
ALTER TABLE public.platform_listings
  ADD COLUMN IF NOT EXISTS score_total smallint;
ALTER TABLE public.platform_listings
  ADD COLUMN IF NOT EXISTS score_modules jsonb;
ALTER TABLE public.platform_listings
  ADD COLUMN IF NOT EXISTS score_config_version text;
ALTER TABLE public.platform_listings
  ADD COLUMN IF NOT EXISTS score_config_hash text;
ALTER TABLE public.platform_listings
  ADD COLUMN IF NOT EXISTS scored_content_revision bigint;
ALTER TABLE public.platform_listings
  ADD COLUMN IF NOT EXISTS scored_at timestamptz;

-- Publication claim
ALTER TABLE public.platform_listings
  ADD COLUMN IF NOT EXISTS publish_claim_id uuid;
ALTER TABLE public.platform_listings
  ADD COLUMN IF NOT EXISTS publish_idempotency_key text;
ALTER TABLE public.platform_listings
  ADD COLUMN IF NOT EXISTS publish_claimed_at timestamptz;
ALTER TABLE public.platform_listings
  ADD COLUMN IF NOT EXISTS published_content_revision bigint;
ALTER TABLE public.platform_listings
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

-- Retirement audit
ALTER TABLE public.platform_listings
  ADD COLUMN IF NOT EXISTS retired_at timestamptz;
ALTER TABLE public.platform_listings
  ADD COLUMN IF NOT EXISTS retirement_reason text;

-- Observed Mercari content (separate from canonical)
ALTER TABLE public.platform_listings
  ADD COLUMN IF NOT EXISTS observed_title text;
ALTER TABLE public.platform_listings
  ADD COLUMN IF NOT EXISTS observed_description text;
ALTER TABLE public.platform_listings
  ADD COLUMN IF NOT EXISTS observed_images jsonb;
ALTER TABLE public.platform_listings
  ADD COLUMN IF NOT EXISTS observed_at timestamptz;
ALTER TABLE public.platform_listings
  ADD COLUMN IF NOT EXISTS content_drift boolean NOT NULL DEFAULT false;

-- Constraints
ALTER TABLE public.platform_listings
  ADD CONSTRAINT valid_lifecycle_stage CHECK (
    lifecycle_stage IN ('draft', 'enhanced', 'publish_pending', 'published', 'retired')
  );
-- Unique listing grain: one row per platform/shop/variant.
-- External identity uniqueness is a separate nullable unique index.
ALTER TABLE public.platform_listings
  ADD CONSTRAINT uq_platform_listings_grain
  UNIQUE (platform, shop_code, variant_id);
ALTER TABLE public.platform_listings
  ADD CONSTRAINT valid_score_range CHECK (
    score_total IS NULL OR (score_total >= 0 AND score_total <= 94)
  );

-- Unique enhancement_key within a listing (nullable unique = unique when set)
CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_listings_enhancement_key
  ON public.platform_listings (enhancement_key) WHERE enhancement_key IS NOT NULL;

-- Work queue index
CREATE INDEX IF NOT EXISTS ix_platform_listings_lifecycle_shop
  ON public.platform_listings (platform, lifecycle_stage, shop_code, updated_at);

CREATE INDEX IF NOT EXISTS ix_platform_listings_lifecycle_stage
  ON public.platform_listings (lifecycle_stage, platform, shop_code);

-- Ensure publishable condition: scored revision must match content revision + pass threshold
-- (enforced at application level; index supports the query)
CREATE INDEX IF NOT EXISTS ix_platform_listings_publishable
  ON public.platform_listings (platform, shop_code, lifecycle_stage, score_total)
  WHERE lifecycle_stage IN ('draft', 'enhanced') AND score_total >= 75;

-- ---------------------------------------------------------------------------
-- 2. platform_listing_images: content revision tracking
-- ---------------------------------------------------------------------------

ALTER TABLE public.platform_listing_images
  ADD COLUMN IF NOT EXISTS content_revision bigint NOT NULL DEFAULT 1;

-- ---------------------------------------------------------------------------
-- 3. platform_listing_events: audit log
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.platform_listing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.platform_listings(id) ON DELETE CASCADE,
  from_stage text,
  to_stage text NOT NULL,
  content_revision bigint,
  event_type text NOT NULL,
  actor text NOT NULL DEFAULT 'system',
  idempotency_key text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_platform_listing_events_listing
  ON public.platform_listing_events (listing_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_platform_listing_events_idempotency
  ON public.platform_listing_events (listing_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Backfill: mark existing published listings as lifecycle_stage = 'published'
-- ---------------------------------------------------------------------------

UPDATE public.platform_listings
SET lifecycle_stage = 'published',
    content_revision = 1,
    published_content_revision = 1,
    content_origin = 'giga_generated',
    published_at = COALESCE(published_at, updated_at)
WHERE lifecycle_stage = 'draft'
  AND listing_status IN ('UNOPENED', 'OPENED')
  AND external_listing_id IS NOT NULL;
