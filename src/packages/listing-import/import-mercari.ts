import { supabase } from '../../lib/supabase.js';
import {
  createImportRun,
  finishImportRun,
  storeRawRows,
} from './import-run.js';
import { parseSourceFile } from './parse-source-file.js';
import { buildLookup } from './supabase-helpers.js';

/**
 * Normalize Mercari 商品ステータス code to RPagentOS status.
 * 2 = active, 1 = inactive, anything else = unknown.
 */
function normalizeMercariStatus(code: string): string {
  switch (code.trim()) {
    case '2': return 'active';
    case '1': return 'inactive';
    default: return 'unknown';
  }
}

/**
 * Import Mercari Shop4 listing CSV.
 *
 * Phases:
 * 1. Parse CSV
 * 2. Create import run + store raw rows
 * 3. Upsert platform_listings (one per 商品ID)
 * 4. Upsert platform_listing_skus (loop SKU1-SKU10 slots)
 * 5. Upsert platform_listing_images (loop 1-20 slots where populated)
 */
export async function importMercari(filePath: string, shopCode: string = 'shop4'): Promise<void> {
  console.log(`\n=== Importing Mercari: ${filePath} (${shopCode}) ===\n`);

  // Phase 1: Parse
  const parsed = parseSourceFile(filePath);
  console.log(`Parsed ${parsed.rowCount} rows, ${parsed.columns.length} columns`);

  // Phase 2: Import run + raw rows
  const runId = await createImportRun({
    sourceSystem: 'mercari',
    platform: 'mercari',
    shopCode,
    sourceFile: filePath,
    fileHash: parsed.fileHash,
    rowCount: parsed.rowCount,
  });
  console.log(`Import run: ${runId}`);

  const { stored, errors } = await storeRawRows(runId, parsed.rows, {
    sourceKeyField: '商品id',
  });
  console.log(`Raw rows: ${stored} stored, ${errors} errors`);

  // Get platform account ID
  const accountMap = await buildLookup('platform_accounts', 'shop_code', 'id');
  const accountId = accountMap.get(shopCode) ?? null;

  // Phase 3: Upsert platform_listings
  const listingIds = await upsertMercariListings(parsed.rows, accountId);
  console.log(`Platform listings: ${listingIds.size} upserted`);

  // Phase 4: Upsert platform_listing_skus
  const skuCount = await upsertMercariSkus(parsed.rows, listingIds);
  console.log(`Platform listing SKUs: ${skuCount} upserted`);

  // Phase 5: Upsert platform_listing_images (only where image_name populated)
  const imgCount = await upsertMercariImages(parsed.rows, listingIds);
  console.log(`Platform listing images: ${imgCount} upserted`);

  await finishImportRun(runId, errors > 0 ? 'partial' : 'completed');
  console.log(`\n=== Mercari import complete ===\n`);
}

// ─── Listings ──────────────────────────────────────────────────────────

async function upsertMercariListings(
  rows: Record<string, string>[],
  accountId: string | null,
): Promise<Map<string, string>> {
  const idField = '商品id';
  const listingMap = new Map<string, string>(); // 商品ID -> listing uuid

  const batchSize = 200;
  const seenIds = new Set<string>();

  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const listings: Array<Record<string, unknown>> = [];

    for (const r of batch) {
      const externalId = r[idField]?.trim();
      if (!externalId || seenIds.has(externalId)) continue;
      seenIds.add(externalId);

      listings.push({
        platform_account_id: accountId,
        platform: 'mercari',
        shop_code: 'shop4',
        external_listing_id: externalId,
        external_snapshot_id: r['スナップショットid']?.trim() || null,
        title: r['商品名']?.trim() || null,
        description: r['商品説明']?.trim() || null,
        category_id: r['カテゴリid']?.trim() || null,
        brand_id: r['ブランドid']?.trim() || null,
        condition_code: r['商品の状態']?.trim() || null,
        shipping_method: r['配送方法']?.trim() || null,
        ship_from_region: r['発送元の地域']?.trim() || null,
        shipping_days: r['発送までの日数']?.trim() || null,
        shipping_paid_by: r['配送料の負担']?.trim() || null,
        parent_group_id: r['商品グループid']?.trim() || null,
        parent_group_name: r['商品グループ名']?.trim() || null,
        current_price: parseNumeric(r['販売価格']),
        listing_status_code: r['商品ステータス']?.trim() || null,
        listing_status: normalizeMercariStatus(r['商品ステータス'] ?? ''),
        published_at: parseTimestamp(r['商品登録日時']),
        platform_updated_at: parseTimestamp(r['最終更新日時']),
        source_hash: r['hash']?.trim() || null,
        url: r['商品url']?.trim() || null,
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
        console.error(`Listing batch ${offset}: ${error.message}`);
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

async function upsertMercariSkus(
  rows: Record<string, string>[],
  listingIds: Map<string, string>,
): Promise<number> {
  let count = 0;
  const batchSize = 200;
  const allSkus: Array<Record<string, unknown>> = [];

  for (const r of rows) {
    const listingId = r['商品id']?.trim();
    if (!listingId) continue;
    const listingUuid = listingIds.get(listingId);
    if (!listingUuid) continue;

    for (let slot = 1; slot <= 10; slot++) {
      const extSkuId = r[`sku${slot}_id`]?.trim();
      const skuCode = r[`sku${slot}_商品管理コード`]?.trim();
      const skuVariety = r[`sku${slot}_種類`]?.trim();         // option value (e.g. "Brown")
      const stockQty = r[`sku${slot}_現在の在庫数`]?.trim();
      const janCode = r[`sku${slot}_janコード`]?.trim();
      const deltaFlag = r[`sku${slot}_増減フラグ`]?.trim();
      const deltaQty = r[`sku${slot}_在庫増減数`]?.trim();

      // Skip empty SKU slots
      if (!extSkuId && !skuCode && !skuVariety && !stockQty) continue;

      allSkus.push({
        listing_id: listingUuid,
        sku_position: slot,
        external_sku_id: extSkuId || null,
        external_snapshot_id: r[`sku${slot}_スナップショットid`]?.trim() || null,
        sku_code: skuCode || null,
        option_value_1: skuVariety || null,
        jan_code: janCode || null,
        catalog_id: r[`sku${slot}_catalog_id`]?.trim() || null,
        current_price: parseNumeric(r['販売価格']),   // listing-level price fallback
        stock_qty: parseInteger(stockQty),
        stock_delta_flag: deltaFlag || null,
        stock_delta_qty: parseInteger(deltaQty),
        raw_payload: { listing_id: listingId, sku_slot: slot },
      });
    }
  }

  // Batch insert (use upsert with onConflict for idempotency)
  for (let offset = 0; offset < allSkus.length; offset += batchSize) {
    const batch = allSkus.slice(offset, offset + batchSize);
    const { error } = await supabase
      .from('platform_listing_skus')
      .upsert(batch, {
        onConflict: 'listing_id,sku_position',
        ignoreDuplicates: false,
      });

    if (!error) count += batch.length;
    else console.error(`SKU batch ${offset}: ${error.message}`);
  }

  return count;
}

// ─── Images ────────────────────────────────────────────────────────────

async function upsertMercariImages(
  rows: Record<string, string>[],
  listingIds: Map<string, string>,
): Promise<number> {
  let count = 0;
  const batchSize = 500;
  const allImages: Array<Record<string, unknown>> = [];

  for (const r of rows) {
    const listingId = r['商品id']?.trim();
    if (!listingId) continue;
    const listingUuid = listingIds.get(listingId);
    if (!listingUuid) continue;

    for (let slot = 1; slot <= 20; slot++) {
      const imgName = r[`商品画像名_${slot}`]?.trim();
      const regFlag = r[`商品画像登録有無_${slot}`]?.trim();
      const updFlag = r[`商品画像更新フラグ_${slot}`]?.trim();

      // Only store if at least one field is populated
      if (!imgName && !regFlag && !updFlag) continue;

      allImages.push({
        listing_id: listingUuid,
        image_position: slot,
        image_name: imgName || null,
        registered_flag: regFlag || null,
        update_flag: updFlag || null,
        source: 'mercari',
        raw_payload: { listing_id: listingId, image_slot: slot },
      });
    }
  }

  for (let offset = 0; offset < allImages.length; offset += batchSize) {
    const batch = allImages.slice(offset, offset + batchSize);
    const { error } = await supabase
      .from('platform_listing_images')
      .upsert(batch, {
        onConflict: 'listing_id,image_position',
        ignoreDuplicates: false,
      });

    if (!error) count += batch.length;
    else console.error(`Image batch ${offset}: ${error.message}`);
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

function parseTimestamp(val: string | undefined): string | null {
  if (!val || val.trim() === '') return null;
  // Mercari uses ISO-like format; pass through if valid
  const d = new Date(val.trim());
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
