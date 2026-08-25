/**
 * Main Image MVP — pure core.
 *
 * Bounded, dependency-free building blocks for the inquiry-linked main-image
 * workflow described in `docs/development/main-image-creation-publishing-mvp.md`.
 * This module performs no I/O, holds no credentials, and is independent of
 * `src/packages/listing-copy/**`.
 *
 * It covers:
 *  - evidence-tagged SPU fact-pack assembly (deterministic, same-SPU only)
 *  - canonical JSON + SHA-256 hashing (Web Crypto)
 *  - the strict OpenAI JSON Schema for the lean `MainImageSchema`
 *  - deterministic semantic schema validation against a fact pack
 *  - HMAC-SHA256 candidate-token signing/verification (base64url, constant-time)
 *  - image byte detection and dimension/size validation (no `sharp`)
 */

/* ------------------------------------------------------------------ *
 * Types: loaded canonical context
 * ------------------------------------------------------------------ */

export interface MainImageListing {
  id: string;
  platform: string;
  shopCode: string;
  externalListingId: string;
  productSpuId: string | null;
  selectedVariantId: string | null;
  title: string | null;
  description: string | null;
  contentRevision: number;
  /** Current ordered listing images (position 0 is the main image). */
  imageUrls: string[];
}

export interface MainImageSpu {
  id: string;
  spuCode: string | null;
  features: string[];
  attributes: Record<string, unknown>;
}

export interface MainImageVariant {
  id: string;
  productSpuId: string;
  itemCode: string | null;
  name: string | null;
  color: string | null;
  colorCode: string | null;
  size: string | null;
  material: string | null;
  quantity: number | null;
  isActive: boolean;
}

export interface MainImageAsset {
  /** Stable `product_assets.id`. */
  id: string;
  spuId: string | null;
  variantId: string | null;
  url: string | null;
  kind: string | null;
  width: number | null;
  height: number | null;
  contentType: string | null;
  byteSize: number | null;
  isUsable: boolean;
}

export interface MainImageAttribute {
  id: string;
  entityType: 'spu' | 'variant' | 'listing';
  entityId: string;
  name: string;
  value: unknown;
  isAllowlisted: boolean;
}

/** Loaded canonical context: one exact listing plus its SPU family and assets. */
export interface MainImageContext {
  listing: MainImageListing;
  spu: MainImageSpu | null;
  variants: MainImageVariant[];
  assets: MainImageAsset[];
  attributes: MainImageAttribute[];
}

/* ------------------------------------------------------------------ *
 * Types: evidence-tagged fact pack
 * ------------------------------------------------------------------ */

export type EvidenceStatus = 'verified' | 'context_only';

export interface ImageEvidence {
  id: string;
  status: EvidenceStatus;
  kind: 'spu_field' | 'spu_feature' | 'variant_field' | 'attribute' | 'listing_field';
  label: string;
  value: unknown;
  /** Stable path describing where the value came from (audit only). */
  sourcePath: string;
  variantId?: string;
}

export interface ImageFactPack {
  listingId: string;
  platform: string;
  shopCode: string;
  externalListingId: string;
  contentRevision: number;
  spuId: string | null;
  selectedVariantId: string | null;
  /** Same-`product_spu_id` active variants, deterministically sorted, deduped. */
  variantIds: string[];
  /** Usable SPU/variant-linked `product_assets.id`, deterministically sorted, deduped. */
  assetIds: string[];
  assets: MainImageAsset[];
  evidence: ImageEvidence[];
  warnings: string[];
}

/* ------------------------------------------------------------------ *
 * Types: lean schema + validation result
 * ------------------------------------------------------------------ */

export const MAIN_IMAGE_SCHEMA_VERSION = '1.0';
export const MAIN_IMAGE_CANVAS_SIZE = 1024;
export const MAIN_IMAGE_SCALE_MIN = 60;
export const MAIN_IMAGE_SCALE_MAX = 80;

export const MAIN_IMAGE_BACKGROUND_COLORS = ['#FFFFFF', '#F7F4EE', '#FAF9F6'] as const;

export const MAIN_IMAGE_ALIGNMENTS = [
  'center',
  'center-left',
  'center-right',
] as const;

export type MainImageAlignment = (typeof MAIN_IMAGE_ALIGNMENTS)[number];

export interface MainImageVariationSwatch {
  variant_id: string;
  label: string;
  color: string;
  source_asset_id: string;
}

export interface MainImageRestrictions {
  no_people: boolean;
  no_logo: boolean;
  no_fake_discount: boolean;
  no_fake_ranking: boolean;
  no_fake_certification: boolean;
  no_unverified_claims: boolean;
  no_product_modification: boolean;
}

export interface MainImageSchema {
  schema_version: string;
  canvas: { width: number; height: number; background_color: string };
  product: {
    scale_percent: number;
    alignment: string;
    preserve_original_product: boolean;
    source_asset_ids: string[];
  };
  copy: {
    headline: string;
    headline_evidence_ids: string[];
    supporting_text: string;
    supporting_evidence_ids: string[];
  };
  feature_ids: string[];
  keyword_ids: string[];
  variation_swatches: MainImageVariationSwatch[];
  restrictions: MainImageRestrictions;
  notes: string;
}

export interface MainImageSchemaValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/* ------------------------------------------------------------------ *
 * Types: candidate token
 * ------------------------------------------------------------------ */

export interface CandidateTokenPayload {
  listingId: string;
  contentRevision: number;
  imageSha256: string;
  schemaHash: string;
  factPackHash: string;
  model: string;
  /** Expiry as epoch seconds (required). */
  exp: number;
}

export type CandidateTokenVerifyResult =
  | { ok: true; payload: CandidateTokenPayload }
  | { ok: false; error: string };

/* ------------------------------------------------------------------ *
 * Types: image bytes
 * ------------------------------------------------------------------ */

export type ImageFormat = 'jpeg' | 'png' | 'webp';

export interface ImageInfo {
  format: ImageFormat | null;
  contentType: string | null;
  width: number | null;
  height: number | null;
}

export interface ImageValidationOptions {
  expectedContentType?: string;
  maxBytes?: number;
}

export interface ImageValidationResult {
  valid: boolean;
  errors: string[];
  info: ImageInfo;
}

export const DEFAULT_MAX_MAIN_IMAGE_BYTES = 8 * 1024 * 1024;

/* ------------------------------------------------------------------ *
 * Canonical JSON + hashing
 * ------------------------------------------------------------------ */

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Recursively sort object keys and normalize non-finite numbers to `null`. */
function canonicalize(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = canonicalize(value[key]);
    }
    return out;
  }
  return value;
}

/** Stable JSON serialization: sorted object keys, no whitespace, normalized numbers. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/** SHA-256 (hex) over the canonical JSON of `value`, using Web Crypto. */
export async function hashCanonicalJson(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return bytesToHex(new Uint8Array(digest));
}

/* ------------------------------------------------------------------ *
 * Fact-pack assembly
 * ------------------------------------------------------------------ */

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortedUniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

const VARIANT_FIELDS: Array<{
  field: string;
  label: string;
  pick: (variant: MainImageVariant) => unknown;
}> = [
  { field: 'item_code', label: 'Item code', pick: (v) => v.itemCode },
  { field: 'name', label: 'Name', pick: (v) => v.name },
  { field: 'color', label: 'Color', pick: (v) => v.color },
  { field: 'color_code', label: 'Color code', pick: (v) => v.colorCode },
  { field: 'size', label: 'Size', pick: (v) => v.size },
  { field: 'material', label: 'Material', pick: (v) => v.material },
  { field: 'quantity', label: 'Quantity', pick: (v) => v.quantity },
];

function populated(value: unknown): boolean {
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'number') return Number.isFinite(value);
  return value !== null && value !== undefined;
}

/**
 * Build a deterministic, evidence-tagged fact pack for one exact listing.
 *
 * Only variants sharing the listing's `product_spu_id` are included; unrelated
 * variants and cross-shop targets are never expanded. Listing title/description
 * are retained as `context_only` evidence, never promoted to verified facts.
 */
export function buildImageFactPack(input: MainImageContext): ImageFactPack {
  const { listing } = input;
  const spu = input.spu ?? null;
  const warnings: string[] = [];

  // The canonical SPU relationship comes from the listing alone, never inferred
  // from a coincidentally-supplied SPU record or from fuzzy matching.
  const spuId = listing.productSpuId;

  if (listing.platform !== 'mercari') {
    warnings.push(`unsupported platform: ${listing.platform || '(missing)'} (only Mercari is supported)`);
  }
  if (!listing.productSpuId) warnings.push('missing: listing.product_spu_id');
  if (spu === null) warnings.push('missing: product SPU record');
  if (spu !== null && listing.productSpuId !== null && spu.id !== listing.productSpuId) {
    warnings.push('conflict: SPU id mismatch between listing and product_spus');
  }

  // Same-SPU variants only, deduped by stable id, deterministically sorted.
  const variantById = new Map<string, MainImageVariant>();
  const duplicateVariantIds: string[] = [];
  let crossSpuCount = 0;
  for (const variant of input.variants ?? []) {
    if (spuId === null) continue; // no listing→SPU relationship: no variants
    if (variant.productSpuId !== spuId) {
      crossSpuCount += 1;
      continue;
    }
    const existing = variantById.get(variant.id);
    if (existing) {
      if (
        existing.itemCode !== variant.itemCode ||
        existing.productSpuId !== variant.productSpuId ||
        existing.name !== variant.name
      ) {
        duplicateVariantIds.push(variant.id);
      }
      continue;
    }
    if (variant.isActive === false) continue;
    variantById.set(variant.id, variant);
  }

  const variants = [...variantById.values()].sort((a, b) => {
    const item = compareStrings(a.itemCode ?? '', b.itemCode ?? '');
    return item !== 0 ? item : compareStrings(a.id, b.id);
  });
  const variantIds = variants.map((v) => v.id);
  const variantIdSet = new Set(variantIds);

  // Usable SPU/variant-linked assets only, deduped by stable id, sorted by id.
  const assetById = new Map<string, MainImageAsset>();
  const duplicateAssetIds: string[] = [];
  const linkedUnusableCount = { value: 0 };
  for (const asset of input.assets ?? []) {
    const linked =
      (asset.spuId !== null && asset.spuId === spuId) ||
      (asset.variantId !== null && variantIdSet.has(asset.variantId));
    if (!linked) continue;
    const existing = assetById.get(asset.id);
    if (existing) {
      if (
        existing.url !== asset.url ||
        existing.contentType !== asset.contentType ||
        existing.byteSize !== asset.byteSize
      ) {
        duplicateAssetIds.push(asset.id);
      }
      continue;
    }
    if (asset.isUsable === false) {
      linkedUnusableCount.value += 1;
      continue;
    }
    assetById.set(asset.id, asset);
  }

  const assets = [...assetById.values()].sort((a, b) => compareStrings(a.id, b.id));
  const assetIds = assets.map((a) => a.id);

  // Evidence: canonical populated fields are `verified`; title/description are `context_only`.
  const evidence: ImageEvidence[] = [];

  if (spu !== null) {
    const spuCode = nonEmptyString(spu.spuCode);
    if (spuCode !== null) {
      evidence.push({
        id: `spu.${spu.id}.spu_code`,
        status: 'verified',
        kind: 'spu_field',
        label: 'SPU code',
        value: spuCode,
        sourcePath: 'product_spus.spu_code',
      });
    }
    const features = sortedUniqueStrings((spu.features ?? []).map(nonEmptyString).filter((v): v is string => v !== null));
    features.forEach((feature, index) => {
      evidence.push({
        id: `spu.${spu.id}.feature.${index}`,
        status: 'verified',
        kind: 'spu_feature',
        label: 'Feature',
        value: feature,
        sourcePath: 'product_spus.features',
      });
    });
  }

  for (const variant of variants) {
    for (const { field, label, pick } of VARIANT_FIELDS) {
      const value = pick(variant);
      if (!populated(value)) continue;
      evidence.push({
        id: `variant.${variant.id}.${field}`,
        status: 'verified',
        kind: 'variant_field',
        label,
        value,
        sourcePath: `product_variants.${field}`,
        variantId: variant.id,
      });
    }
  }

  const allowlistedAttributes = (input.attributes ?? [])
    .filter((attr) => attr.isAllowlisted)
    .sort((a, b) => compareStrings(a.id, b.id));
  for (const attr of allowlistedAttributes) {
    if (!populated(attr.value)) continue;
    evidence.push({
      id: `attribute.${attr.id}`,
      status: 'verified',
      kind: 'attribute',
      label: attr.name,
      value: attr.value,
      sourcePath: `${attr.entityType}.${attr.entityId}.${attr.name}`,
    });
  }

  const title = nonEmptyString(listing.title);
  const description = nonEmptyString(listing.description);
  if (title !== null) {
    evidence.push({
      id: 'listing.title',
      status: 'context_only',
      kind: 'listing_field',
      label: 'Listing title',
      value: title,
      sourcePath: 'platform_listings.title',
    });
  }
  if (description !== null) {
    evidence.push({
      id: 'listing.description',
      status: 'context_only',
      kind: 'listing_field',
      label: 'Listing description',
      value: description,
      sourcePath: 'platform_listings.description',
    });
  }

  // Deterministic warnings.
  if (crossSpuCount > 0) {
    warnings.push(`warning: ${crossSpuCount} variant(s) outside the target SPU excluded`);
  }
  for (const id of sortedUniqueStrings(duplicateVariantIds)) {
    warnings.push(`conflict: duplicate variant id "${id}" with conflicting data`);
  }
  for (const id of sortedUniqueStrings(duplicateAssetIds)) {
    warnings.push(`conflict: duplicate asset id "${id}" with conflicting data`);
  }
  if (linkedUnusableCount.value > 0) {
    warnings.push(`warning: ${linkedUnusableCount.value} linked source image(s) unusable and excluded`);
  }
  if (assetIds.length === 0) warnings.push('missing: no usable source images');
  if (listing.selectedVariantId) {
    const selected = variantById.get(listing.selectedVariantId);
    if (!selected) {
      warnings.push('missing: selected variant not found in the same SPU');
    }
  }
  if (title === null) warnings.push('missing: listing title');
  if (description === null) warnings.push('missing: listing description');
  if (spu !== null && nonEmptyString(spu.spuCode) === null) warnings.push('missing: SPU code');

  return {
    listingId: listing.id,
    platform: listing.platform,
    shopCode: listing.shopCode,
    externalListingId: listing.externalListingId,
    contentRevision: listing.contentRevision,
    spuId,
    selectedVariantId: listing.selectedVariantId,
    variantIds,
    assetIds,
    assets,
    evidence,
    warnings,
  };
}

/* ------------------------------------------------------------------ *
 * Strict OpenAI JSON Schema for the lean MainImageSchema
 * ------------------------------------------------------------------ */

const HEX_COLOR_PATTERN = '^#[0-9a-fA-F]{6}$';

const RESTRICTION_KEYS = [
  'no_people',
  'no_logo',
  'no_fake_discount',
  'no_fake_ranking',
  'no_fake_certification',
  'no_unverified_claims',
  'no_product_modification',
] as const;

const restrictionProperties: Record<string, unknown> = {};
for (const key of RESTRICTION_KEYS) {
  restrictionProperties[key] = { type: 'boolean', const: true };
}

/**
 * Strict Structured Outputs JSON Schema (OpenAI) for `MainImageSchema`.
 *
 * - 1024×1024 square canvas (const)
 * - bounded scale (`30..100`) and alignment (enum)
 * - evidence-linked copy arrays
 * - same-SPU variation swatches
 * - mandatory restrictions all `const: true`
 * - `additionalProperties: false` everywhere; no unknown properties
 */
export const MAIN_IMAGE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schema_version',
    'canvas',
    'product',
    'copy',
    'feature_ids',
    'keyword_ids',
    'variation_swatches',
    'restrictions',
    'notes',
  ],
  properties: {
    schema_version: { type: 'string', const: MAIN_IMAGE_SCHEMA_VERSION },
    canvas: {
      type: 'object',
      additionalProperties: false,
      required: ['width', 'height', 'background_color'],
      properties: {
        width: { type: 'integer', const: MAIN_IMAGE_CANVAS_SIZE },
        height: { type: 'integer', const: MAIN_IMAGE_CANVAS_SIZE },
        background_color: { type: 'string', enum: [...MAIN_IMAGE_BACKGROUND_COLORS] },
      },
    },
    product: {
      type: 'object',
      additionalProperties: false,
      required: ['scale_percent', 'alignment', 'preserve_original_product', 'source_asset_ids'],
      properties: {
        scale_percent: { type: 'integer', minimum: MAIN_IMAGE_SCALE_MIN, maximum: MAIN_IMAGE_SCALE_MAX },
        alignment: { type: 'string', enum: [...MAIN_IMAGE_ALIGNMENTS] },
        preserve_original_product: { type: 'boolean', const: true },
        source_asset_ids: { type: 'array', items: { type: 'string' } },
      },
    },
    copy: {
      type: 'object',
      additionalProperties: false,
      required: ['headline', 'headline_evidence_ids', 'supporting_text', 'supporting_evidence_ids'],
      properties: {
        headline: { type: 'string' },
        headline_evidence_ids: { type: 'array', items: { type: 'string' } },
        supporting_text: { type: 'string' },
        supporting_evidence_ids: { type: 'array', items: { type: 'string' } },
      },
    },
    feature_ids: { type: 'array', items: { type: 'string' } },
    keyword_ids: { type: 'array', items: { type: 'string' } },
    variation_swatches: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['variant_id', 'label', 'color', 'source_asset_id'],
        properties: {
          variant_id: { type: 'string' },
          label: { type: 'string' },
          color: { type: 'string', pattern: HEX_COLOR_PATTERN },
          source_asset_id: { type: 'string' },
        },
      },
    },
    restrictions: {
      type: 'object',
      additionalProperties: false,
      required: [...RESTRICTION_KEYS],
      properties: restrictionProperties,
    },
    notes: { type: 'string' },
  },
};

/* ------------------------------------------------------------------ *
 * Deterministic schema validation
 * ------------------------------------------------------------------ */

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const TOP_LEVEL_KEYS = new Set([
  'schema_version',
  'canvas',
  'product',
  'copy',
  'feature_ids',
  'keyword_ids',
  'variation_swatches',
  'restrictions',
  'notes',
]);
const CANVAS_KEYS = new Set(['width', 'height', 'background_color']);
const PRODUCT_KEYS = new Set(['scale_percent', 'alignment', 'preserve_original_product', 'source_asset_ids']);
const COPY_KEYS = new Set(['headline', 'headline_evidence_ids', 'supporting_text', 'supporting_evidence_ids']);
const SWATCH_KEYS = new Set(['variant_id', 'label', 'color', 'source_asset_id']);
const ALIGNMENT_SET = new Set<string>(MAIN_IMAGE_ALIGNMENTS);

function reportUnknownKeys(prefix: string, keys: string[], allowed: Set<string>, errors: string[]): void {
  for (const key of keys.sort(compareStrings)) {
    if (!allowed.has(key)) errors.push(`${prefix} has unknown key: ${key}`);
  }
}

function validateEvidenceIds(
  fieldName: string,
  ids: unknown,
  evidenceById: Map<string, ImageEvidence>,
  confirmed: Set<string>,
  errors: string[],
): void {
  if (!Array.isArray(ids)) {
    errors.push(`${fieldName} must be an array`);
    return;
  }
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id !== 'string') {
      errors.push(`${fieldName} contains a non-string ID`);
      continue;
    }
    if (seen.has(id)) {
      errors.push(`${fieldName} contains duplicate ID: ${id}`);
      continue;
    }
    seen.add(id);
    const evidence = evidenceById.get(id);
    if (!evidence) {
      errors.push(`${fieldName} references unknown evidence ID: ${id}`);
      continue;
    }
    if (evidence.status === 'context_only' && !confirmed.has(id)) {
      errors.push(`${fieldName} references unconfirmed context-only evidence: ${id}`);
    }
  }
}

function validateCopy(
  copy: unknown,
  evidenceById: Map<string, ImageEvidence>,
  confirmed: Set<string>,
  errors: string[],
  warnings: string[],
): void {
  if (!isObject(copy)) {
    errors.push('copy must be an object');
    return;
  }
  reportUnknownKeys('copy', Object.keys(copy), COPY_KEYS, errors);
  if (typeof copy.headline !== 'string') errors.push('copy.headline must be a string');
  if (typeof copy.supporting_text !== 'string') errors.push('copy.supporting_text must be a string');
  validateEvidenceIds('copy.headline_evidence_ids', copy.headline_evidence_ids, evidenceById, confirmed, errors);
  validateEvidenceIds('copy.supporting_evidence_ids', copy.supporting_evidence_ids, evidenceById, confirmed, errors);
  if (typeof copy.headline === 'string' && copy.headline.trim() !== '' && Array.isArray(copy.headline_evidence_ids) && copy.headline_evidence_ids.length === 0) {
    errors.push('copy.headline is non-empty but has no evidence links');
  }
  if (typeof copy.supporting_text === 'string' && copy.supporting_text.trim() !== '' && Array.isArray(copy.supporting_evidence_ids) && copy.supporting_evidence_ids.length === 0) {
    errors.push('copy.supporting_text is non-empty but has no evidence links');
  }
  validateCopyGrounding('copy.headline', copy.headline, copy.headline_evidence_ids, evidenceById, errors);
  validateCopyGrounding('copy.supporting_text', copy.supporting_text, copy.supporting_evidence_ids, evidenceById, errors);
}

function normalizedCopyText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/\s+/gu, '');
}

function evidenceCopyText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function validateCopyGrounding(
  fieldName: string,
  text: unknown,
  ids: unknown,
  evidenceById: Map<string, ImageEvidence>,
  errors: string[],
): void {
  if (typeof text !== 'string' || text.trim() === '' || !Array.isArray(ids) || ids.length === 0) return;
  let remainder = normalizedCopyText(text);
  const citedValues: string[] = [];
  for (const id of ids) {
    if (typeof id !== 'string') continue;
    const evidence = evidenceById.get(id);
    const value = evidence ? evidenceCopyText(evidence.value) : null;
    if (!value) continue;
    const normalized = normalizedCopyText(value);
    citedValues.push(normalized);
    if (!remainder.includes(normalized)) {
      errors.push(`${fieldName} does not contain cited evidence value: ${id}`);
    }
  }
  for (const value of citedValues.sort((a, b) => b.length - a.length)) {
    remainder = remainder.split(value).join('');
  }
  remainder = remainder.replace(/[・／/｜|,，、:：;；\-–—()（）[\]【】]/gu, '');
  if (remainder !== '') {
    errors.push(`${fieldName} contains text not present in its cited evidence`);
  }
}

function validateProduct(
  product: unknown,
  assetIds: Set<string>,
  assetsById: Map<string, MainImageAsset>,
  selectedVariantId: string | null,
  errors: string[],
  warnings: string[],
): void {
  if (!isObject(product)) {
    errors.push('product must be an object');
    return;
  }
  reportUnknownKeys('product', Object.keys(product), PRODUCT_KEYS, errors);

  const scale = product.scale_percent;
  if (
    typeof scale !== 'number' ||
    !Number.isInteger(scale) ||
    scale < MAIN_IMAGE_SCALE_MIN ||
    scale > MAIN_IMAGE_SCALE_MAX
  ) {
    errors.push(`product.scale_percent must be an integer between ${MAIN_IMAGE_SCALE_MIN} and ${MAIN_IMAGE_SCALE_MAX}`);
  }
  if (typeof product.alignment !== 'string' || !ALIGNMENT_SET.has(product.alignment)) {
    errors.push(`product.alignment must be one of: ${MAIN_IMAGE_ALIGNMENTS.join(', ')}`);
  }
  if (product.preserve_original_product !== true) {
    errors.push('product.preserve_original_product must be true');
  }

  const sourceAssetIds = product.source_asset_ids;
  if (!Array.isArray(sourceAssetIds)) {
    errors.push('product.source_asset_ids must be an array');
  } else if (sourceAssetIds.length === 0) {
    errors.push('product.source_asset_ids must contain at least one usable source image');
  } else {
    const seen = new Set<string>();
    for (const id of sourceAssetIds) {
      if (typeof id !== 'string') {
        errors.push('product.source_asset_ids contains a non-string ID');
        continue;
      }
      if (seen.has(id)) {
        errors.push(`product.source_asset_ids contains duplicate ID: ${id}`);
        continue;
      }
      seen.add(id);
      if (!assetIds.has(id)) {
        errors.push(`product.source_asset_ids references unknown asset: ${id}`);
        continue;
      }
      const asset = assetsById.get(id);
      if (asset && asset.variantId !== null && asset.variantId !== selectedVariantId) {
        warnings.push(`product.source_asset_id "${id}" is linked to a non-selected variant`);
      }
    }
  }
}

function validateVariationSwatches(
  swatches: unknown,
  factPack: ImageFactPack,
  errors: string[],
): void {
  if (!Array.isArray(swatches)) {
    errors.push('variation_swatches must be an array');
    return;
  }
  const assetById = new Map(factPack.assets.map((a) => [a.id, a]));
  const variantIdSet = new Set(factPack.variantIds);
  const seenVariants = new Set<string>();
  swatches.forEach((swatch, index) => {
    const prefix = `variation_swatches[${index}]`;
    if (!isObject(swatch)) {
      errors.push(`${prefix} must be an object`);
      return;
    }
    reportUnknownKeys(prefix, Object.keys(swatch), SWATCH_KEYS, errors);

    const variantId = swatch.variant_id;
    if (typeof variantId !== 'string' || variantId === '') {
      errors.push(`${prefix}.variant_id must be a non-empty string`);
    } else {
      if (seenVariants.has(variantId)) {
        errors.push(`${prefix}.variant_id duplicates variant: ${variantId}`);
      }
      seenVariants.add(variantId);
      if (!variantIdSet.has(variantId)) {
        errors.push(`${prefix}.variant_id is not in the same SPU: ${variantId}`);
      }
    }

    if (typeof swatch.label !== 'string' || swatch.label.trim() === '') {
      errors.push(`${prefix}.label must be a non-empty string`);
    }
    if (typeof swatch.color !== 'string' || !HEX_RE.test(swatch.color)) {
      errors.push(`${prefix}.color must be a #RRGGBB hex color`);
    }

    const sourceAssetId = swatch.source_asset_id;
    if (typeof sourceAssetId !== 'string' || sourceAssetId === '') {
      errors.push(`${prefix}.source_asset_id must be a non-empty string`);
    } else {
      const asset = assetById.get(sourceAssetId);
      if (!asset) {
        errors.push(`${prefix}.source_asset_id references unknown asset: ${sourceAssetId}`);
      } else if (typeof variantId === 'string' && variantId !== '' && asset.variantId !== variantId) {
        errors.push(`${prefix}.source_asset_id is not linked to variant ${variantId}`);
      }
    }
  });
}

function validateRestrictions(restrictions: unknown, errors: string[]): void {
  if (!isObject(restrictions)) {
    errors.push('restrictions must be an object');
    return;
  }
  reportUnknownKeys('restrictions', Object.keys(restrictions), new Set(RESTRICTION_KEYS), errors);
  for (const key of RESTRICTION_KEYS) {
    if (restrictions[key] !== true) {
      errors.push(`restrictions.${key} must be true (mandatory restrictions cannot be weakened)`);
    }
  }
}

function validateCanvas(canvas: unknown, errors: string[]): void {
  if (!isObject(canvas)) {
    errors.push('canvas must be an object');
    return;
  }
  reportUnknownKeys('canvas', Object.keys(canvas), CANVAS_KEYS, errors);
  if (canvas.width !== MAIN_IMAGE_CANVAS_SIZE) {
    errors.push(`canvas.width must be ${MAIN_IMAGE_CANVAS_SIZE}`);
  }
  if (canvas.height !== MAIN_IMAGE_CANVAS_SIZE) {
    errors.push(`canvas.height must be ${MAIN_IMAGE_CANVAS_SIZE}`);
  }
  if (
    typeof canvas.background_color !== 'string'
    || !(MAIN_IMAGE_BACKGROUND_COLORS as readonly string[]).includes(canvas.background_color)
  ) {
    errors.push(`canvas.background_color must be one of: ${MAIN_IMAGE_BACKGROUND_COLORS.join(', ')}`);
  }
}

/**
 * Deterministically validate an (operator-edited) schema against a fact pack.
 *
 * Rejects unknown keys/IDs, non-1024 canvas, out-of-range values, unknown
 * assets/variants, asset↔variant mismatches, weakened restrictions, and
 * duplicates. Only `verified` evidence or explicitly confirmed `context_only`
 * evidence may be referenced. Errors are reported, never silently repaired.
 */
export function validateMainImageSchema(
  schema: MainImageSchema,
  factPack: ImageFactPack,
  confirmedContextEvidenceIds: ReadonlySet<string> | readonly string[] = [],
): MainImageSchemaValidationResult {
  const confirmed = new Set(confirmedContextEvidenceIds);
  const errors: string[] = [];
  const warnings: string[] = [];
  const root = schema as unknown as Record<string, unknown>;

  reportUnknownKeys('schema', Object.keys(root), TOP_LEVEL_KEYS, errors);

  if (root.schema_version !== MAIN_IMAGE_SCHEMA_VERSION) {
    errors.push(`schema_version must be "${MAIN_IMAGE_SCHEMA_VERSION}"`);
  }

  validateCanvas(root.canvas, errors);

  const evidenceById = new Map(factPack.evidence.map((e) => [e.id, e]));
  const assetIds = new Set(factPack.assetIds);
  const assetsById = new Map(factPack.assets.map((a) => [a.id, a]));

  validateProduct(root.product, assetIds, assetsById, factPack.selectedVariantId, errors, warnings);
  validateCopy(root.copy, evidenceById, confirmed, errors, warnings);
  validateEvidenceIds('feature_ids', root.feature_ids, evidenceById, confirmed, errors);
  validateEvidenceIds('keyword_ids', root.keyword_ids, evidenceById, confirmed, errors);
  validateVariationSwatches(root.variation_swatches, factPack, errors);
  validateRestrictions(root.restrictions, errors);

  if (typeof root.notes !== 'string') errors.push('notes must be a string');

  return { valid: errors.length === 0, errors, warnings };
}

/* ------------------------------------------------------------------ *
 * Candidate-token HMAC-SHA256
 * ------------------------------------------------------------------ */

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Constant-time byte comparison (length-equal inputs). */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' } as const,
    false,
    ['sign'] as KeyUsage[],
  );
  const signature = await globalThis.crypto.subtle.sign(
    { name: 'HMAC' } as const,
    key,
    new TextEncoder().encode(message),
  );
  return new Uint8Array(signature);
}

function isTokenPayloadWithExpiry(value: unknown): value is CandidateTokenPayload {
  if (!isObject(value)) return false;
  return typeof value.exp === 'number' && Number.isFinite(value.exp);
}

/** Sign a candidate token payload, returning `base64url(payload).base64url(signature)`. */
export async function signCandidateToken(payload: CandidateTokenPayload, secret: string): Promise<string> {
  if (!isTokenPayloadWithExpiry(payload)) {
    throw new Error('candidate token payload must include a finite numeric exp');
  }
  const payloadSegment = bytesToBase64Url(new TextEncoder().encode(canonicalJson(payload)));
  const signature = await hmacSha256(secret, payloadSegment);
  return `${payloadSegment}.${bytesToBase64Url(signature)}`;
}

/**
 * Verify a `base64url(payload).base64url(signature)` candidate token.
 * Signature comparison is constant-time; expiry is required and enforced.
 */
export async function verifyCandidateToken(
  token: string,
  secret: string,
  nowEpochSeconds: number = Math.floor(Date.now() / 1000),
): Promise<CandidateTokenVerifyResult> {
  const parts = token.split('.');
  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') {
    return { ok: false, error: 'malformed_token' };
  }
  const [payloadSegment, signatureSegment] = parts;

  let payload: CandidateTokenPayload;
  try {
    const payloadBytes = base64UrlToBytes(payloadSegment);
    if (bytesToBase64Url(payloadBytes) !== payloadSegment) return { ok: false, error: 'invalid_payload' };
    payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as CandidateTokenPayload;
  } catch {
    return { ok: false, error: 'invalid_payload' };
  }
  if (!isTokenPayloadWithExpiry(payload)) {
    return { ok: false, error: 'missing_expiry' };
  }

  let providedSignature: Uint8Array;
  try {
    providedSignature = base64UrlToBytes(signatureSegment);
  } catch {
    return { ok: false, error: 'invalid_signature' };
  }
  if (providedSignature.length !== 32) {
    return { ok: false, error: 'invalid_signature' };
  }
  if (bytesToBase64Url(providedSignature) !== signatureSegment) {
    return { ok: false, error: 'invalid_signature' };
  }

  const expectedSignature = await hmacSha256(secret, payloadSegment);
  if (!timingSafeEqual(expectedSignature, providedSignature)) {
    return { ok: false, error: 'signature_mismatch' };
  }

  if (nowEpochSeconds >= payload.exp) {
    return { ok: false, error: 'expired' };
  }

  return { ok: true, payload };
}

/* ------------------------------------------------------------------ *
 * Image byte helpers
 * ------------------------------------------------------------------ */

const FORMAT_CONTENT_TYPES: Record<ImageFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function hasPrefix(bytes: Uint8Array, offset: number, prefix: number[]): boolean {
  if (offset + prefix.length > bytes.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (bytes[offset + i] !== prefix[i]) return false;
  }
  return true;
}

/** Detect JPEG/PNG/WebP by magic bytes. Returns `null` for SVG/unknown. */
export function detectImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (hasPrefix(bytes, 0, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (hasPrefix(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (hasPrefix(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && hasPrefix(bytes, 8, [0x57, 0x45, 0x42, 0x50])) {
    return 'webp';
  }
  return null;
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function readPngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  return { width: readUint32BE(bytes, 16), height: readUint32BE(bytes, 20) };
}

function readJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    if (offset + 4 > bytes.length) return null;
    const segmentLength = readUint16BE(bytes, offset + 2);
    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame && segmentLength >= 7 && offset + 9 <= bytes.length) {
      return { height: readUint16BE(bytes, offset + 5), width: readUint16BE(bytes, offset + 7) };
    }
    offset += 2 + segmentLength;
  }
  return null;
}

function readWebpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 20) return null;
  if (hasPrefix(bytes, 12, [0x56, 0x50, 0x38, 0x58]) && bytes.length >= 30) {
    // VP8X: 24-bit little-endian canvas width-1 / height-1.
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    return { width, height };
  }
  if (hasPrefix(bytes, 12, [0x56, 0x50, 0x38, 0x20]) && bytes.length >= 30) {
    // VP8 lossy: frame tag starts after the chunk header at offset 20.
    if (hasPrefix(bytes, 23, [0x9d, 0x01, 0x2a])) {
      return { width: readUint16LE(bytes, 26) & 0x3fff, height: readUint16LE(bytes, 28) & 0x3fff };
    }
    return null;
  }
  if (hasPrefix(bytes, 12, [0x56, 0x50, 0x38, 0x4c]) && bytes.length >= 25) {
    // VP8L lossless: 14-bit width-1 / height-1 packed after the 0x2f signature.
    const b0 = bytes[21];
    const b1 = bytes[22];
    const b2 = bytes[23];
    const b3 = bytes[24];
    const width = 1 + ((b1 & 0x3f) << 8 | b0);
    const height = 1 + ((b3 & 0x0f) << 10 | (b2 << 2) | (b1 >> 6));
    return { width, height };
  }
  return null;
}

/** Read pixel dimensions without `sharp` (JPEG/PNG/WebP). Cloudflare compatible. */
export function readImageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const format = detectImageFormat(bytes);
  if (format === 'png') return readPngDimensions(bytes);
  if (format === 'jpeg') return readJpegDimensions(bytes);
  if (format === 'webp') return readWebpDimensions(bytes);
  return null;
}

/**
 * Validate candidate/save bytes: known raster magic bytes (no SVG), byte limit,
 * square 1024×1024 dimensions, and optional expected content type.
 */
export function validateMainImageBytes(
  bytes: Uint8Array,
  options: ImageValidationOptions = {},
): ImageValidationResult {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_MAIN_IMAGE_BYTES;
  const errors: string[] = [];

  if (bytes.length === 0) errors.push('image is empty');
  if (bytes.length > maxBytes) errors.push(`image exceeds byte limit of ${maxBytes} bytes`);

  const format = detectImageFormat(bytes);
  if (format === null) {
    errors.push('unsupported or non-raster image format (SVG is rejected)');
  }

  const expectedContentType = options.expectedContentType;
  const contentType = format === null ? null : FORMAT_CONTENT_TYPES[format];
  if (format !== null && expectedContentType && contentType !== expectedContentType) {
    errors.push(`content type ${contentType} does not match expected ${expectedContentType}`);
  }

  const dimensions = readImageDimensions(bytes);
  if (dimensions === null) {
    if (format !== null) errors.push('could not read image dimensions');
  } else if (dimensions.width !== MAIN_IMAGE_CANVAS_SIZE || dimensions.height !== MAIN_IMAGE_CANVAS_SIZE) {
    errors.push(
      `image must be ${MAIN_IMAGE_CANVAS_SIZE}x${MAIN_IMAGE_CANVAS_SIZE}, got ${dimensions.width}x${dimensions.height}`,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    info: { format, contentType, width: dimensions?.width ?? null, height: dimensions?.height ?? null },
  };
}
