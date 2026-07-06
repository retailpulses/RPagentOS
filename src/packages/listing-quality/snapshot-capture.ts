// Snapshot capture — fetches listing + image data from the database and creates
// an immutable review snapshot. Computes source_hash for idempotent re-review.

import { createHash } from 'crypto';
import { supabase } from '../../lib/supabase.js';
import type {
  Marketplace,
  ReviewSnapshot,
  SnapshotImage,
  SnapshotImageInput,
} from './types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((k) => `${JSON.stringify(k)}:${stableJson(record[k])}`).join(',')}}`;
}

function computeSourceHash(parts: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(parts).sort()) {
    sorted[key] = parts[key];
  }
  return createHash('sha256').update(stableJson(sorted)).digest('hex');
}

// ─── Fetch listing with images ────────────────────────────────────────────────

interface ListingRow {
  id: string;
  external_listing_id: string | null;
  platform: string;
  shop_code: string | null;
  title: string | null;
  description: string | null;
  listing_status: string | null;
  current_price: number | null;
  product_spu_id: string | null;
  product_family_id: string | null;
}

interface ListingImageRow {
  id: string;
  listing_id: string;
  image_position: number;
  image_url: string | null;
  source_asset_id?: string;
}

async function fetchListing(listingId: string): Promise<ListingRow> {
  const { data, error } = await supabase
    .from('platform_listings')
    .select(`
      id, external_listing_id, platform, shop_code, title, description,
      listing_status, current_price, product_spu_id, product_family_id
    `)
    .eq('id', listingId)
    .single();

  if (error) throw new Error(`Fetch listing ${listingId}: ${error.message}`);
  return data as unknown as ListingRow;
}

async function fetchListingImages(listingId: string): Promise<ListingImageRow[]> {
  const all: ListingImageRow[] = [];
  const pageSize = 200;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('platform_listing_images')
      .select('id,listing_id,image_position,image_url')
      .eq('listing_id', listingId)
      .order('image_position', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error(`Fetch images for ${listingId}: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as unknown as ListingImageRow[]));
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return all;
}

async function checkHeroProduct(productSpuId: string | null): Promise<boolean> {
  if (!productSpuId) return false;
  const { data, error } = await supabase
    .from('merchandising_focus_items')
    .select('id')
    .eq('product_spu_id', productSpuId)
    .eq('focus_type', 'hero')
    .eq('status', 'active')
    .limit(1);

  if (error) return false;
  return (data?.length ?? 0) > 0;
}

// ─── Capture ──────────────────────────────────────────────────────────────────

export interface CaptureInput {
  listingId: string;
}

export interface CaptureOutput {
  snapshot: ReviewSnapshot;
  images: SnapshotImage[];
}

/**
 * Capture a listing's current state as an immutable review snapshot.
 * Computes source_hash for idempotent re-review: same state → same hash.
 */
export async function captureSnapshot(input: CaptureInput): Promise<CaptureOutput> {
  const listing = await fetchListing(input.listingId);
  const imageRows = await fetchListingImages(input.listingId);
  const isHero = await checkHeroProduct(listing.product_spu_id);

  const imageUrls = imageRows
    .filter((r) => r.image_url)
    .map((r) => r.image_url as string);

  const isMainImage = (pos: number) => pos === 0;

  const sourceHash = computeSourceHash({
    listing_id: listing.id,
    title: listing.title,
    description: listing.description,
    status: listing.listing_status,
    price: listing.current_price,
    image_urls: imageUrls.sort(),
    product_spu_id: listing.product_spu_id,
  });

  // Check if an identical snapshot already exists
  const { data: existing } = await supabase
    .from('listing_review_snapshots')
    .select('id')
    .eq('listing_id', listing.id)
    .eq('source_hash', sourceHash)
    .order('created_at', { ascending: false })
    .limit(1);

  if (existing && existing.length > 0) {
    // Return existing snapshot + images
    const snapshotId = (existing[0] as { id: string }).id;
    return loadExistingSnapshot(snapshotId);
  }

  // Insert snapshot
  const { data: snapshotRow, error: snapErr } = await supabase
    .from('listing_review_snapshots')
    .insert({
      marketplace: listing.platform as Marketplace,
      listing_id: listing.id,
      external_listing_id: listing.external_listing_id,
      shop_code: listing.shop_code,
      product_spu_id: listing.product_spu_id,
      product_family_id: listing.product_family_id,
      is_hero_product: isHero,
      title: listing.title,
      description: listing.description,
      bullet_points_json: null,
      price: listing.current_price,
      image_urls_json: imageUrls,
      product_facts_json: {},
      marketplace_status: listing.listing_status,
      source_hash: sourceHash,
    })
    .select('*')
    .single();

  if (snapErr) throw new Error(`Insert snapshot: ${snapErr.message}`);
  const snapshot = snapshotRow as unknown as ReviewSnapshot;

  // Insert snapshot images
  const snapshotImages: SnapshotImage[] = [];
  for (const img of imageRows) {
    const input: SnapshotImageInput = {
      image_index: img.image_position,
      image_url: img.image_url ?? '',
      platform_image_id: img.id,
      is_main_image: isMainImage(img.image_position),
    };

    const { data: imgRow, error: imgErr } = await supabase
      .from('listing_review_snapshot_images')
      .insert({
        snapshot_id: snapshot.id,
        image_index: input.image_index,
        image_url: input.image_url,
        platform_image_id: input.platform_image_id,
        is_main_image: input.is_main_image ?? false,
      })
      .select('*')
      .single();

    if (imgErr) throw new Error(`Insert snapshot image: ${imgErr.message}`);
    snapshotImages.push(imgRow as unknown as SnapshotImage);
  }

  return { snapshot, images: snapshotImages };
}

/**
 * Load an existing snapshot and its images (for idempotent re-review skip).
 */
async function loadExistingSnapshot(snapshotId: string): Promise<CaptureOutput> {
  const { data: snap, error: snapErr } = await supabase
    .from('listing_review_snapshots')
    .select('*')
    .eq('id', snapshotId)
    .single();

  if (snapErr) throw new Error(`Load snapshot ${snapshotId}: ${snapErr.message}`);

  const { data: imgs, error: imgErr } = await supabase
    .from('listing_review_snapshot_images')
    .select('*')
    .eq('snapshot_id', snapshotId)
    .order('image_index', { ascending: true });

  if (imgErr) throw new Error(`Load snapshot images: ${imgErr.message}`);

  return {
    snapshot: snap as unknown as ReviewSnapshot,
    images: (imgs ?? []) as unknown as SnapshotImage[],
  };
}
