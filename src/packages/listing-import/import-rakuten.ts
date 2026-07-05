import { supabase } from '../../lib/supabase.js';
import {
  createImportRun,
  finishImportRun,
  storeRawRows,
} from './import-run.js';
import { parseSourceFile } from './parse-source-file.js';
import { buildLookup } from './supabase-helpers.js';

/**
 * Normalize Rakuten listing status from 倉庫指定 + サーチ表示 combo.
 * - 倉庫指定=0 and サーチ表示=1 → active
 * - Otherwise → inactive (conservative default)
 * - Unknown → unknown
 */
function normalizeRakutenStatus(sokoShitei: string, searchHyouji: string): string {
  if (sokoShitei === '0' && searchHyouji === '1') return 'active';
  if (sokoShitei === '1') return 'inactive';   // warehouse-only
  if (searchHyouji === '0') return 'inactive';  // search hidden
  if (!sokoShitei && !searchHyouji) return 'unknown';
  return 'unknown';
}

/**
 * Import Rakuten listing CSV.
 *
 * Phases:
 * 1. Parse CSV
 * 2. Create import run + store raw rows
 * 3. Upsert platform_listings (one per unique 商品管理番号_商品url)
 * 4. Upsert platform_listing_skus (one per populated SKU row)
 * 5. Upsert platform_listing_images (loop 1-20 slots)
 * 6. Upsert platform_listing_attributes (loop 1-42 attribute pairs)
 */
export async function importRakuten(filePath: string, shopCode: string = 'homebliss'): Promise<void> {
  console.log(`\n=== Importing Rakuten: ${filePath} (${shopCode}) ===\n`);

  // Phase 1: Parse
  const parsed = parseSourceFile(filePath);
  console.log(`Parsed ${parsed.rowCount} rows, ${parsed.columns.length} columns`);

  // Phase 2: Import run + raw rows
  const runId = await createImportRun({
    sourceSystem: 'rakuten',
    platform: 'rakuten',
    shopCode,
    sourceFile: filePath,
    fileHash: parsed.fileHash,
    rowCount: parsed.rowCount,
  });
  console.log(`Import run: ${runId}`);

  const { stored, errors } = await storeRawRows(runId, parsed.rows, {
    sourceKeyField: '商品管理番号_商品url',
  });
  console.log(`Raw rows: ${stored} stored, ${errors} errors`);

  const accountMap = await buildLookup('platform_accounts', 'shop_code', 'id');
  const accountId = accountMap.get(shopCode) ?? null;

  // Phase 3: Upsert platform_listings (grouped by unique manage number)
  const listingIds = await upsertRakutenListings(parsed.rows, accountId);
  console.log(`Platform listings: ${listingIds.size} upserted`);

  // Phase 4: Upsert platform_listing_skus
  const skuCount = await upsertRakutenSkus(parsed.rows, listingIds);
  console.log(`Platform listing SKUs: ${skuCount} upserted`);

  // Phase 5: Upsert platform_listing_images
  const imgCount = await upsertRakutenImages(parsed.rows, listingIds);
  console.log(`Platform listing images: ${imgCount} upserted`);

  // Phase 6: Upsert platform_listing_attributes
  const attrCount = await upsertRakutenAttributes(parsed.rows, listingIds);
  console.log(`Platform listing attributes: ${attrCount} upserted`);

  await finishImportRun(runId, errors > 0 ? 'partial' : 'completed');
  console.log(`\n=== Rakuten import complete ===\n`);
}

// ─── Listings ──────────────────────────────────────────────────────────

async function upsertRakutenListings(
  rows: Record<string, string>[],
  accountId: string | null,
): Promise<Map<string, string>> {
  const idField = '商品管理番号_商品url';
  const listingMap = new Map<string, string>();
  const seen = new Set<string>();

  const batchSize = 200;
  const deduped: Record<string, string>[] = [];

  for (const r of rows) {
    const extId = r[idField]?.trim();
    if (!extId || seen.has(extId)) continue;
    seen.add(extId);
    deduped.push(r);
  }

  for (let offset = 0; offset < deduped.length; offset += batchSize) {
    const batch = deduped.slice(offset, offset + batchSize);
    const listings: Array<Record<string, unknown>> = [];

    for (const r of batch) {
      const extId = r[idField]?.trim();
      listings.push({
        platform_account_id: accountId,
        platform: 'rakuten',
        shop_code: 'homebliss',
        external_listing_id: extId,
        manage_number: extId,  // Same as external_listing_id for Rakuten
        title: r['商品名']?.trim() || null,
        description: r['pc用商品説明文']?.trim() || r['スマートフォン用商品説明文']?.trim() || null,
        category_id: r['ジャンルid']?.trim() || null,
        listing_status_code: `倉庫指定:${r['倉庫指定']?.trim() ?? ''}/サーチ表示:${r['サーチ表示']?.trim() ?? ''}`,
        listing_status: normalizeRakutenStatus(r['倉庫指定'] ?? '', r['サーチ表示'] ?? ''),
        current_price: parseNumeric(r['通常購入販売価格']),
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

async function upsertRakutenSkus(
  rows: Record<string, string>[],
  listingIds: Map<string, string>,
): Promise<number> {
  let count = 0;
  const batchSize = 200;
  const batch: Array<Record<string, unknown>> = [];
  let positionCounter = new Map<string, number>(); // listing_uuid -> next sku_position

  for (const r of rows) {
    const manageNumber = r['商品管理番号_商品url']?.trim();
    const sellerSku = r['sku管理番号']?.trim();
    if (!manageNumber || !sellerSku) continue;

    const listingUuid = listingIds.get(manageNumber);
    if (!listingUuid) continue;

    const pos = (positionCounter.get(listingUuid) ?? 0) + 1;
    positionCounter.set(listingUuid, pos);

    batch.push({
      listing_id: listingUuid,
      sku_position: pos,
      seller_sku: sellerSku,
      sku_code: r['システム連携用sku番号']?.trim() || null,
      current_price: parseNumeric(r['通常購入販売価格']),
      stock_qty: parseInteger(r['在庫数']),
      stock_delta_flag: r['在庫戻しフラグ']?.trim() || null,
      stock_status_code: r['在庫切れ時の注文受付']?.trim() || null,
      raw_payload: r,
    });

    if (batch.length >= batchSize) {
      const { error } = await supabase
        .from('platform_listing_skus')
        .upsert(batch, { onConflict: 'listing_id,sku_position', ignoreDuplicates: false });

      if (!error) count += batch.length;
      else console.error(`SKU batch: ${error.message}`);
      batch.length = 0;
    }
  }

  // Flush remaining
  if (batch.length > 0) {
    const { error } = await supabase
      .from('platform_listing_skus')
      .upsert(batch, { onConflict: 'listing_id,sku_position', ignoreDuplicates: false });
    if (!error) count += batch.length;
    else console.error(`SKU batch (final): ${error.message}`);
  }

  return count;
}

// ─── Images ────────────────────────────────────────────────────────────

async function upsertRakutenImages(
  rows: Record<string, string>[],
  listingIds: Map<string, string>,
): Promise<number> {
  let count = 0;
  const batchSize = 500;
  const allImages: Array<Record<string, unknown>> = [];

  for (const r of rows) {
    const manageNumber = r['商品管理番号_商品url']?.trim();
    if (!manageNumber) continue;
    const listingUuid = listingIds.get(manageNumber);
    if (!listingUuid) continue;

    for (let slot = 1; slot <= 20; slot++) {
      const imgType = r[`商品画像タイプ${slot}`]?.trim();
      const imgPath = r[`商品画像パス${slot}`]?.trim();
      const altText = r[`商品画像名_alt_${slot}`]?.trim();

      if (!imgType && !imgPath && !altText) continue;

      allImages.push({
        listing_id: listingUuid,
        image_position: slot,
        image_type: imgType || null,
        image_path: imgPath || null,
        alt_text: altText || null,
        source: 'rakuten',
        raw_payload: { manageNumber, image_slot: slot },
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

// ─── Attributes ────────────────────────────────────────────────────────

async function upsertRakutenAttributes(
  rows: Record<string, string>[],
  listingIds: Map<string, string>,
): Promise<number> {
  let count = 0;
  const batchSize = 500;
  const allAttrs: Array<Record<string, unknown>> = [];

  for (const r of rows) {
    const manageNumber = r['商品管理番号_商品url']?.trim();
    if (!manageNumber) continue;
    const listingUuid = listingIds.get(manageNumber);
    if (!listingUuid) continue;

    for (let slot = 1; slot <= 42; slot++) {
      const key = r[`商品属性_項目_${slot}`]?.trim();
      const value = r[`商品属性_値_${slot}`]?.trim();
      const unit = r[`商品属性_単位_${slot}`]?.trim();

      if (!key) continue;

      allAttrs.push({
        listing_id: listingUuid,
        attribute_position: slot,
        attribute_key: key,
        attribute_value: value || null,
        attribute_unit: unit || null,
        source: 'rakuten',
        raw_payload: { manageNumber, attr_slot: slot },
      });
    }
  }

  for (let offset = 0; offset < allAttrs.length; offset += batchSize) {
    const batch = allAttrs.slice(offset, offset + batchSize);
    const { error } = await supabase
      .from('platform_listing_attributes')
      .insert(batch);

    if (!error) count += batch.length;
    else console.error(`Attr batch ${offset}: ${error.message}`);
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
