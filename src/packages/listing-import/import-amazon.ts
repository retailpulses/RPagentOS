import { supabase } from '../../lib/supabase.js';
import {
  createImportRun,
  finishImportRun,
  storeRawRows,
} from './import-run.js';
import { parseSourceFile } from './parse-source-file.js';
import { buildLookup } from './supabase-helpers.js';

// ─────────────────────────────────────────────────────────────────────────
// Amazon Mapping Import
// ─────────────────────────────────────────────────────────────────────────

/**
 * Import Amazon listing mapping CSV (Item Code → Amazon Seller SKU).
 *
 * Stores raw mapping rows in source_import_rows.
 * Does NOT create listing rows — only preserves the mapping
 * for later link resolution.
 */
export async function importAmazonMapping(filePath: string): Promise<string> {
  console.log(`\n--- Amazon Mapping: ${filePath} ---`);

  const parsed = parseSourceFile(filePath);
  console.log(`Parsed ${parsed.rowCount} rows`);

  const runId = await createImportRun({
    sourceSystem: 'amazon_mapping',
    platform: 'amazon',
    shopCode: 'jp',
    sourceFile: filePath,
    fileHash: parsed.fileHash,
    rowCount: parsed.rowCount,
  });

  const { stored, errors } = await storeRawRows(runId, parsed.rows, {
    sourceKeyField: 'sku',
  });
  console.log(`Mapping rows: ${stored} stored, ${errors} errors`);

  await finishImportRun(runId, 'completed');
  console.log(`--- Amazon mapping complete ---\n`);
  return runId;
}

// ─────────────────────────────────────────────────────────────────────────
// Amazon Open Listings Import
// ─────────────────────────────────────────────────────────────────────────

/**
 * Import Amazon open listings TSV.
 *
 * Phases:
 * 1. Parse TSV
 * 2. Create import run + store raw rows
 * 3. Upsert platform_listings (seller-sku as external_listing_id)
 * 4. Upsert platform_listing_skus
 * 5. Upsert platform_listing_price_tiers (quantity + progressive)
 */
export async function importAmazon(filePath: string, shopCode: string = 'jp'): Promise<void> {
  console.log(`\n=== Importing Amazon: ${filePath} (${shopCode}) ===\n`);

  // Phase 1: Parse
  const parsed = parseSourceFile(filePath);
  console.log(`Parsed ${parsed.rowCount} rows`);

  // Phase 2: Import run + raw rows
  const runId = await createImportRun({
    sourceSystem: 'amazon',
    platform: 'amazon',
    shopCode,
    sourceFile: filePath,
    fileHash: parsed.fileHash,
    rowCount: parsed.rowCount,
  });
  console.log(`Import run: ${runId}`);

  const { stored, errors } = await storeRawRows(runId, parsed.rows, {
    sourceKeyField: 'seller-sku',
  });
  console.log(`Raw rows: ${stored} stored, ${errors} errors`);

  const accountMap = await buildLookup('platform_accounts', 'shop_code', 'id');
  const accountId = accountMap.get(shopCode) ?? null;

  // Phase 3: Upsert platform_listings
  const listingIds = await upsertAmazonListings(parsed.rows, accountId);
  console.log(`Platform listings: ${listingIds.size} upserted`);

  // Phase 4: Upsert platform_listing_skus
  const skuMap = await upsertAmazonSkus(parsed.rows, listingIds);
  console.log(`Platform listing SKUs: ${skuMap.size} upserted`);

  // Phase 5: Upsert price tiers
  const tierCount = await upsertAmazonPriceTiers(parsed.rows, skuMap);
  console.log(`Price tiers: ${tierCount} upserted`);

  await finishImportRun(runId, errors > 0 ? 'partial' : 'completed');
  console.log(`\n=== Amazon import complete ===\n`);
}

// ─── Listings ──────────────────────────────────────────────────────────

async function upsertAmazonListings(
  rows: Record<string, string>[],
  accountId: string | null,
): Promise<Map<string, string>> {
  const listingMap = new Map<string, string>();
  const batchSize = 200;

  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const listings: Array<Record<string, unknown>> = [];

    for (const r of batch) {
      const sellerSku = r['seller-sku']?.trim();
      if (!sellerSku) continue;

      const qty = parseInteger(r['quantity']);

      listings.push({
        platform_account_id: accountId,
        platform: 'amazon',
        shop_code: 'jp',
        external_listing_id: sellerSku,
        current_price: parseNumeric(r['price']),
        stock_qty: qty ?? 0,
        listing_status: qty != null ? (qty > 0 ? 'active' : 'sold_out') : 'unknown',
        listing_status_code: r['quantity']?.trim() || null,
        raw_payload: r,
      });
    }

    if (listings.length > 0) {
      const { data, error } = await supabase
        .from('platform_listings')
        .upsert(listings, {
          onConflict: 'platform,shop_code,external_listing_id',
          ignoreDuplicates: false,
        })
        .select('id,external_listing_id');

      if (error) {
        console.error(`Listing batch: ${error.message}`);
      } else if (data) {
        for (const row of data) {
          listingMap.set(row.external_listing_id, row.id);
        }
      }
    }
  }

  return listingMap;
}

// ─── SKUs ──────────────────────────────────────────────────────────────

async function upsertAmazonSkus(
  rows: Record<string, string>[],
  listingIds: Map<string, string>,
): Promise<Map<string, string>> {
  const skuMap = new Map<string, string>(); // seller-sku → sku_uuid
  const batchSize = 200;

  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const skus: Array<Record<string, unknown>> = [];

    for (const r of batch) {
      const sellerSku = r['seller-sku']?.trim();
      if (!sellerSku) continue;
      const listingUuid = listingIds.get(sellerSku);
      if (!listingUuid) continue;

      skus.push({
        listing_id: listingUuid,
        sku_position: 1,
        seller_sku: sellerSku,
        sku_code: sellerSku,  // same as seller-sku for Amazon
        asin: r['product-id']?.trim() || null,
        current_price: parseNumeric(r['price']),
        business_price: parseNumeric(r['business_price']),
        stock_qty: parseInteger(r['quantity']),
        raw_payload: r,
      });
    }

    if (skus.length > 0) {
      const { data, error } = await supabase
        .from('platform_listing_skus')
        .upsert(skus, {
          onConflict: 'listing_id,sku_position',
          ignoreDuplicates: false,
        })
        .select('id,seller_sku');

      if (error) {
        console.error(`SKU batch: ${error.message}`);
      } else if (data) {
        for (const row of data) {
          skuMap.set(row.seller_sku, row.id);
        }
      }
    }
  }

  return skuMap;
}

// ─── Price Tiers ───────────────────────────────────────────────────────

async function upsertAmazonPriceTiers(
  rows: Record<string, string>[],
  skuMap: Map<string, string>,
): Promise<number> {
  let count = 0;
  const batchSize = 200;
  const allTiers: Array<Record<string, unknown>> = [];

  for (const r of rows) {
    const sellerSku = r['seller-sku']?.trim();
    if (!sellerSku) continue;
    const skuUuid = skuMap.get(sellerSku);
    if (!skuUuid) continue;

    // Quantity tiers (1-5)
    for (let slot = 1; slot <= 5; slot++) {
      const lowerBound = r[`quantity_lower_bound_${slot}`]?.trim();
      const price = r[`quantity_price_${slot}`]?.trim();
      if (!lowerBound || !price) continue;

      allTiers.push({
        listing_sku_id: skuUuid,
        tier_type: 'quantity',
        price_type: r['quantity_price_type']?.trim() || null,
        lower_bound: parseInt(lowerBound, 10),
        price: parseNumeric(price),
      });
    }

    // Progressive tiers (1-3)
    for (let slot = 1; slot <= 3; slot++) {
      const lowerBound = r[`progressive_lower_bound_${slot}`]?.trim();
      const price = r[`progressive_price_${slot}`]?.trim();
      if (!lowerBound || !price) continue;

      allTiers.push({
        listing_sku_id: skuUuid,
        tier_type: 'progressive',
        price_type: r['progressive_price_type']?.trim() || null,
        lower_bound: parseInt(lowerBound, 10),
        price: parseNumeric(price),
      });
    }
  }

  for (let offset = 0; offset < allTiers.length; offset += batchSize) {
    const batch = allTiers.slice(offset, offset + batchSize);
    const { error } = await supabase
      .from('platform_listing_price_tiers')
      .upsert(batch, {
        onConflict: 'listing_sku_id,tier_type,lower_bound',
        ignoreDuplicates: false,
      });

    if (!error) count += batch.length;
    else console.error(`Tier batch: ${error.message}`);
  }

  return count;
}

// ─── Helpers ───────────────────────────────────────────────────────────

function parseNumeric(val: string | undefined): number | null {
  if (!val || val.trim() === '') return null;
  const n = Number(val.trim().replace(/[,￥¥$]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseInteger(val: string | undefined): number | null {
  if (!val || val.trim() === '') return null;
  const n = parseInt(val.trim(), 10);
  return Number.isFinite(n) ? n : null;
}
