// Marketplace-specific scoring configuration.
//
// Each marketplace (Amazon, Rakuten, Mercari) has distinct expectations for
// listing quality — this module centralizes the weights, thresholds, and
// requirements so the score engine stays deterministic and config-driven.

import type { Marketplace } from './types.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MarketplaceScoreWeights {
  /** Image health: loaded ratio, HTTP status, resolution */
  technical: number;
  /** Image quality: count, main image, coverage gaps */
  image: number;
  /** OCR text quality: keyword presence, description extraction */
  content: number;
  /** Marketplace rule compliance */
  compliance: number;
  /** Conversion optimization: lifestyle/dimension/closeup presence */
  conversion: number;
  /** Operational risk: broken main image, anomalies */
  operationalRisk: number;
}

export interface MarketplaceThresholds {
  /** Score below this → critical */
  critical: number;
  /** Score below this → high (must be > critical) */
  high: number;
  /** Score below this → medium (must be > high) */
  medium: number;
}

export interface MarketplaceImageRequirements {
  /** Minimum image count expected by the marketplace */
  minImageCount: number;
  /** Recommended image count */
  recommendedImageCount: number;
  /** Minimum acceptable resolution (width or height), pixels */
  minDimension: number;
}

export interface MarketplaceScoreConfig {
  marketplace: Marketplace;
  weights: MarketplaceScoreWeights;
  thresholds: MarketplaceThresholds;
  imageRequirements: MarketplaceImageRequirements;
  /** Rule IDs enabled for this marketplace (Phase 4). */
  rules: string[];
}

// ─── Marketplace Configs ────────────────────────────────────────────────────

const AMAZON_CONFIG: MarketplaceScoreConfig = {
  marketplace: 'amazon',
  weights: {
    technical: 0.25,
    image: 0.20,
    content: 0.20,
    compliance: 0.20,
    conversion: 0.10,
    operationalRisk: 0.05,
  },
  thresholds: {
    critical: 40,
    high: 60,
    medium: 80,
  },
  imageRequirements: {
    minImageCount: 1,
    recommendedImageCount: 7,
    minDimension: 500,
  },
  rules: [
    'amazon_main_image_white_bg',
    'amazon_main_image_no_text',
    'amazon_main_image_min_1600px',
    'amazon_image_count_6plus',
    'amazon_title_format',
    'amazon_bullet_points_count',
    'amazon_prohibited_claims',
  ],
};

const RAKUTEN_CONFIG: MarketplaceScoreConfig = {
  marketplace: 'rakuten',
  weights: {
    technical: 0.20,
    image: 0.25,
    content: 0.25,
    compliance: 0.15,
    conversion: 0.10,
    operationalRisk: 0.05,
  },
  thresholds: {
    critical: 40,
    high: 60,
    medium: 80,
  },
  imageRequirements: {
    minImageCount: 1,
    recommendedImageCount: 10,
    minDimension: 300,
  },
  rules: [
    'rakuten_image_count_5plus',
    'rakuten_no_price_in_image',
    'rakuten_category_fields',
    'rakuten_title_length',
    'rakuten_description_min_200',
  ],
};

const MERCARI_CONFIG: MarketplaceScoreConfig = {
  marketplace: 'mercari',
  weights: {
    technical: 0.20,
    image: 0.30,
    content: 0.15,
    compliance: 0.20,
    conversion: 0.10,
    operationalRisk: 0.05,
  },
  thresholds: {
    critical: 40,
    high: 60,
    medium: 80,
  },
  imageRequirements: {
    minImageCount: 1,
    recommendedImageCount: 10,
    minDimension: 300,
  },
  rules: [
    'mercari_image_count_3plus',
    'mercari_no_external_links',
    'mercari_used_item_condition_photo',
    'mercari_shipping_info',
    'mercari_title_brand_model',
  ],
};

const CONFIG_BY_MARKETPLACE: Record<Marketplace, MarketplaceScoreConfig> = {
  amazon: AMAZON_CONFIG,
  rakuten: RAKUTEN_CONFIG,
  mercari: MERCARI_CONFIG,
};

// ─── Public API ─────────────────────────────────────────────────────────────

export function getMarketplaceConfig(marketplace: Marketplace): MarketplaceScoreConfig {
  const config = CONFIG_BY_MARKETPLACE[marketplace];
  if (!config) {
    throw new Error(`No score config for marketplace: ${marketplace}`);
  }
  return config;
}

export function getWeights(marketplace: Marketplace): MarketplaceScoreWeights {
  return getMarketplaceConfig(marketplace).weights;
}

export function getThresholds(marketplace: Marketplace): MarketplaceThresholds {
  return getMarketplaceConfig(marketplace).thresholds;
}

export function getImageRequirements(marketplace: Marketplace): MarketplaceImageRequirements {
  return getMarketplaceConfig(marketplace).imageRequirements;
}

/**
 * Get the list of enabled marketplace compliance rule IDs for a marketplace.
 * Falls back to an empty array if no rules are configured.
 */
export function getEnabledRules(marketplace: Marketplace): string[] {
  const config = CONFIG_BY_MARKETPLACE[marketplace];
  if (!config) return [];
  return config.rules ?? [];
}

/**
 * Validate that weights sum to approximately 1.0 (within floating-point tolerance).
 */
export function validateWeights(weights: MarketplaceScoreWeights): boolean {
  const sum =
    weights.technical +
    weights.image +
    weights.content +
    weights.compliance +
    weights.conversion +
    weights.operationalRisk;
  return Math.abs(sum - 1.0) < 0.001;
}
