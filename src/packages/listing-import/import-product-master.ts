import { supabase } from '../../lib/supabase.js';
import {
  createImportRun,
  finishImportRun,
  storeRawRows,
  updateRowStatus,
} from './import-run.js';
import { parseSourceFile } from './parse-source-file.js';
import { fetchAll, buildLookup } from './supabase-helpers.js';
import { PLATFORM_ACCOUNTS } from './types.js';

/**
 * Seed platform_accounts if they don't exist yet.
 */
async function seedPlatformAccounts(): Promise<Map<string, string>> {
  const map = new Map<string, string>(); // key: "platform:shop_code" -> account id

  for (const acct of PLATFORM_ACCOUNTS) {
    const { data: existing } = await supabase
      .from('platform_accounts')
      .select('id')
      .eq('platform', acct.platform)
      .eq('shop_code', acct.shop_code)
      .limit(1);

    if (existing && existing.length > 0) {
      map.set(`${acct.platform}:${acct.shop_code}`, existing[0].id);
      continue;
    }

    const { data: created, error } = await supabase
      .from('platform_accounts')
      .insert(acct)
      .select('id')
      .single();

    if (error) {
      console.error(`Failed to seed platform account ${acct.platform}/${acct.shop_code}: ${error.message}`);
    } else if (created) {
      map.set(`${acct.platform}:${acct.shop_code}`, created.id);
    }
  }

  return map;
}

/**
 * Import product master CSV into canonical product tables.
 *
 * Phases:
 * 1. Parse CSV
 * 2. Create import run + store raw rows
 * 3. Seed platform accounts
 * 4. Upsert product_families (from Giga Product Group)
 * 5. Upsert product_spus (from SPU1)
 * 6. Upsert product_variants (from item_code) with SPU linkage
 * 7. Upsert product_commercials (per variant)
 * 8. Upsert product_assets (from Image URLs JSON)
 *
 * Idempotent: re-running with the same file hash skips if already completed.
 */
export async function importProductMaster(filePath: string): Promise<void> {
  console.log(`\n=== Importing Product Master: ${filePath} ===\n`);

  // Phase 1: Parse
  const parsed = parseSourceFile(filePath);
  console.log(`Parsed ${parsed.rowCount} rows, ${parsed.columns.length} columns`);

  // Phase 2: Import run + raw rows
  const runId = await createImportRun({
    sourceSystem: 'product_master',
    sourceFile: filePath,
    fileHash: parsed.fileHash,
    rowCount: parsed.rowCount,
  });
  console.log(`Import run: ${runId}`);

  const { stored, errors } = await storeRawRows(runId, parsed.rows, {
    sourceKeyField: 'item_code',
  });
  console.log(`Raw rows: ${stored} stored, ${errors} errors`);

  // Phase 3: Seed platform accounts
  await seedPlatformAccounts();
  console.log('Platform accounts seeded');

  // Phase 4: Product Families (from Giga Product Group)
  const familyCount = await upsertProductFamilies(parsed.rows);
  console.log(`Product families: ${familyCount} upserted`);

  // Phase 5: Product SPUs (from SPU1)
  const spuCount = await upsertProductSpus(parsed.rows);
  console.log(`Product SPUs: ${spuCount} upserted`);

  // Phase 5b: Backfill SPU titles (most common Product Name per SPU1)
  await backfillSpuTitles(parsed.rows);
  console.log('SPU titles backfilled');

  // Phase 6: Product Variants
  const { variantCount, variantErrors } = await upsertProductVariants(parsed.rows, runId);
  console.log(`Product variants: ${variantCount} upserted, ${variantErrors} errors`);

  // Phase 7: Product Commercials
  const commercialCount = await upsertProductCommercials(parsed.rows);
  console.log(`Product commercials: ${commercialCount} upserted`);

  // Phase 8: Product Assets
  const assetCount = await upsertProductAssets(parsed.rows);
  console.log(`Product assets: ${assetCount} upserted`);

  // Done
  await finishImportRun(runId, errors > 0 ? 'partial' : 'completed');
  console.log(`\n=== Product master import complete ===\n`);
}

// ─── Family ────────────────────────────────────────────────────────────

async function upsertProductFamilies(
  rows: Record<string, string>[],
): Promise<number> {
  // Use Giga Product Group for family grouping
  const groupField = 'giga_product_group';
  const groups = new Set<string>();
  for (const r of rows) {
    const g = r[groupField]?.trim();
    if (g) groups.add(g);
  }

  let count = 0;
  for (const groupName of groups) {
    const code = groupName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    // Find first row for this group to get category
    const sampleRow = rows.find((r) => (r[groupField] || '').trim() === groupName);
    const category = sampleRow?.['product_group']?.trim() ?? null;

    const { error } = await supabase.from('product_families').upsert(
      {
        family_code: code,
        family_name: groupName,
        category,
        status: 'active',
      },
      { onConflict: 'family_code', ignoreDuplicates: false },
    );

    if (!error) count++;
    else console.error(`Family ${groupName}: ${error.message}`);
  }

  return count;
}

// ─── SPU ───────────────────────────────────────────────────────────────

async function upsertProductSpus(
  rows: Record<string, string>[],
): Promise<number> {
  const spuField = 'spu1';
  const seen = new Map<string, Record<string, string>>(); // spu_code -> first row

  for (const r of rows) {
    const spu = r[spuField]?.trim();
    if (spu && !seen.has(spu)) {
      seen.set(spu, r);
    }
  }

  // Load family lookup: family_name -> family_id
  const familyByName = await buildLookup('product_families', 'family_name', 'id');

  let count = 0;
  for (const [spuCode, row] of seen) {
    const gigaGroup = row['giga_product_group']?.trim() ?? '';
    const familyId = familyByName.get(gigaGroup) ?? null;
    const manufacturerModel = row['spu2_メーカー型番']?.trim() ?? null;
    const category = row['product_group']?.trim() ?? null;

    // Title: use this row's Product Name; will be backfilled with most common later
    const title = row['product_name']?.trim() || spuCode;

    const { error } = await supabase.from('product_spus').upsert(
      {
        spu_code: spuCode,
        product_family_id: familyId,
        title,
        manufacturer_model: manufacturerModel,
        category,
        status: 'active',
      },
      { onConflict: 'spu_code', ignoreDuplicates: false },
    );

    if (!error) count++;
    else console.error(`SPU ${spuCode}: ${error.message}`);
  }

  return count;
}

// ─── SPU Title Backfill ────────────────────────────────────────────────

async function backfillSpuTitles(rows: Record<string, string>[]): Promise<void> {
  // Group product names by SPU1, count occurrences, pick most common
  const spuTitles = new Map<string, Map<string, { count: number; firstIndex: number }>>();

  for (let i = 0; i < rows.length; i++) {
    const spu = rows[i]['spu1']?.trim();
    const name = rows[i]['product_name']?.trim();
    if (!spu || !name) continue;

    if (!spuTitles.has(spu)) spuTitles.set(spu, new Map());
    const nameMap = spuTitles.get(spu)!;
    const existing = nameMap.get(name);
    if (existing) {
      existing.count++;
    } else {
      nameMap.set(name, { count: 1, firstIndex: i });
    }
  }

  // Pick best title per SPU: most common, tiebreak by first occurrence
  const updates: Array<{ spu_code: string; title: string }> = [];
  for (const [spuCode, nameMap] of spuTitles) {
    let bestName = '';
    let bestCount = 0;
    let bestIndex = Infinity;

    for (const [name, info] of nameMap) {
      if (info.count > bestCount || (info.count === bestCount && info.firstIndex < bestIndex)) {
        bestName = name;
        bestCount = info.count;
        bestIndex = info.firstIndex;
      }
    }

    if (bestName) {
      updates.push({ spu_code: spuCode, title: bestName });
    }
  }

  // Batch update
  const batchSize = 200;
  for (let offset = 0; offset < updates.length; offset += batchSize) {
    const batch = updates.slice(offset, offset + batchSize);
    for (const u of batch) {
      const { error } = await supabase
        .from('product_spus')
        .update({ title: u.title })
        .eq('spu_code', u.spu_code);

      if (error) {
        console.error(`SPU title backfill ${u.spu_code}: ${error.message}`);
      }
    }
  }
}

// ─── Variant ───────────────────────────────────────────────────────────

async function upsertProductVariants(
  rows: Record<string, string>[],
  runId: string,
): Promise<{ variantCount: number; variantErrors: number }> {
  // Load SPU lookup: spu_code -> spu_id
  const spuByCode = await buildLookup('product_spus', 'spu_code', 'id');

  let count = 0;
  let errors = 0;

  // Batch upsert
  const batchSize = 200;
  const validRows = rows.filter((r) => (r['item_code']?.trim() ?? '') !== '');

  for (let offset = 0; offset < validRows.length; offset += batchSize) {
    const batch = validRows.slice(offset, offset + batchSize);
    const variants: Array<Record<string, unknown>> = [];

    for (const r of batch) {
      const itemCode = r['item_code']?.trim() ?? '';
      const spu1 = r['spu1']?.trim() ?? '';
      const spuId = spuByCode.get(spu1) ?? null;

      if (!itemCode) {
        await updateRowStatus(runId, rows.indexOf(r), 'error', 'Blank item_code');
        errors++;
        continue;
      }

      variants.push({
        item_code: itemCode,
        sku: itemCode, // backward-compatible alias
        shop_sku: r['shop_sku']?.trim() || null,
        product_spu_id: spuId,
        variant_name: r['product_name']?.trim() || null,
        color: r['color']?.trim() || null,
        color_code: r['color_code']?.trim() || null,
        size_text: r['size_text']?.trim() || null,
        material: r['material']?.trim() || null,
        material_ja: r['material_ja']?.trim() || null,
        country_of_origin_ja: r['country_of_origin_ja']?.trim() || null,
        assembly_status: r['assembly_status']?.trim() || null,
        package_width_cm: parseNumeric(r['package_width_cm']),
        package_height_cm: parseNumeric(r['package_height_cm']),
        package_length_cm: parseNumeric(r['package_length_cm']),
        package_weight_kg: parseNumeric(r['package_weight_kg']),
        product_weight_kg: parseNumeric(r['product_weight_kg']),
        package_quantity: parseInteger(r['package_quantity']),
        status: 'active',
        raw_payload: r,
      });
    }

    if (variants.length > 0) {
      const { error } = await supabase
        .from('product_variants')
        .upsert(variants, {
          onConflict: 'item_code',
          ignoreDuplicates: false,
        });

      if (error) {
        console.error(`Variant batch ${offset}: ${error.message}`);
        errors += variants.length;
      } else {
        count += variants.length;
      }
    }
  }

  return { variantCount: count, variantErrors: errors };
}

// ─── Commercials ───────────────────────────────────────────────────────

async function upsertProductCommercials(
  rows: Record<string, string>[],
): Promise<number> {
  // Load variant lookup: item_code -> variant_id
  const variantByItemCode = await buildLookup('product_variants', 'item_code', 'id');

  let count = 0;
  const batchSize = 200;

  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const commercials: Array<Record<string, unknown>> = [];

    for (const r of batch) {
      const itemCode = r['item_code']?.trim() ?? '';
      const variantId = variantByItemCode.get(itemCode);
      if (!variantId) continue;

      commercials.push({
        variant_id: variantId,
        source_available_qty: parseInteger(r['qty_available']),
        owned_qty: parseInteger(r['owned_qty']),
        purchased_qty: parseInteger(r['qty_purchased']),
        source_unit_price: parseNumeric(r['unit_price']),
        discounted_unit_price: parseNumeric(r['discounted_unit_price']),
        fulfillment_fee: parseNumeric(r['unit_fulfillment_fee_drop_shipping_']),
        amazon_target_price: parseNumeric(r['amazon_pricing']),
        rakuten_target_price: parseNumeric(r['rakuten_pricing']),
        mercari_effective_price_excl_shipping: parseNumeric(
          r['mercari_effective_price_excl_shipping'],
        ),
        mercari_effective_price_incl_shipping: parseNumeric(
          r['mercari_effective_price_incl_shipping'],
        ),
        floor_price_incl_shipping: parseNumeric(r['floor_price_incl_shipping']),
        ceiling_price_incl_shipping: parseNumeric(r['ceiling_price_incl_shipping']),
        listing_readiness_score: parseNumeric(r['listing_readiness_score']),
        audit_notes: r['audit_notes']?.trim() || null,
        inventory_status: r['inventory_status']?.trim() || null,
        raw_payload: r,
      });
    }

    if (commercials.length > 0) {
      const { error } = await supabase
        .from('product_commercials')
        .upsert(commercials, {
          onConflict: 'variant_id',
          ignoreDuplicates: false,
        });

      if (!error) count += commercials.length;
      else console.error(`Commercials batch ${offset}: ${error.message}`);
    }
  }

  return count;
}

// ─── Assets ────────────────────────────────────────────────────────────

async function upsertProductAssets(
  rows: Record<string, string>[],
): Promise<number> {
  const variantByItemCode = await buildLookup('product_variants', 'item_code', 'id');
  const spuByCode = await buildLookup('product_spus', 'spu_code', 'id');

  // Collect all variant→URL pairs first, with dedup at SPU level.
  // Key: `${spuId}::${assetUrl}`, Value: canonical asset row
  const canonicalByKey = new Map<string, {
    product_spu_id: string | null;
    asset_url: string;
    position: number;
    raw_payload: Record<string, unknown>;
  }>();

  // Variant→image links to write after asset upsert
  interface VariantLink {
    spu_id: string | null;
    asset_url: string;
    variant_id: string | null;
    item_code: string;
    position: number;
  }
  const variantLinks: VariantLink[] = [];

  for (const r of rows) {
    const jsonStr = r['image_urls_json']?.trim();
    if (!jsonStr) continue;

    let urls: string[];
    try {
      const parsed = JSON.parse(jsonStr);
      urls = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      continue;
    }

    const itemCode = r['item_code']?.trim() ?? '';
    const spu1 = r['spu1']?.trim() ?? '';
    const variantId = variantByItemCode.get(itemCode) ?? null;
    const spuId = spuByCode.get(spu1) ?? null;

    const allUrls = [...urls];
    const mainImg = r['product_main_image']?.trim();
    if (mainImg && !allUrls.includes(mainImg)) {
      allUrls.unshift(mainImg); // position 0
    }

    for (let pos = 0; pos < allUrls.length; pos++) {
      const url = allUrls[pos];
      if (typeof url !== 'string' || !url.trim()) continue;

      const cleanUrl = url.trim();
      const key = `${spuId ?? '__no_spu__'}::${cleanUrl}`;

      // Level 1 dedup: one canonical row per (SPU, URL)
      if (!canonicalByKey.has(key)) {
        canonicalByKey.set(key, {
          product_spu_id: spuId,
          asset_url: cleanUrl,
          position: pos === 0 && mainImg && !urls.includes(cleanUrl) ? 0 : pos + 1,
          raw_payload: { source_row_item_code: itemCode },
        });
      }

      // Always record variant→image link
      variantLinks.push({
        spu_id: spuId,
        asset_url: cleanUrl,
        variant_id: variantId,
        item_code: itemCode,
        position: pos,
      });
    }
  }

  // Fetch existing assets for dedup against DB state
  const spuIds = [...new Set(Array.from(canonicalByKey.values()).map(a => a.product_spu_id).filter(Boolean))];
  const existingUrls = new Map<string, string>(); // key → asset_id
  if (spuIds.length > 0) {
    for (let i = 0; i < spuIds.length; i += 100) {
      const batch = spuIds.slice(i, i + 100);
      const { data } = await supabase
        .from('product_assets')
        .select('id, product_spu_id, asset_url')
        .eq('asset_type', 'image')
        .in('product_spu_id', batch);

      for (const row of (data ?? [])) {
        const key = `${row.product_spu_id}::${row.asset_url}`;
        existingUrls.set(key, row.id as string);
      }
    }
  }

  // Upsert canonical assets (skip if already exists)
  let assetCount = 0;
  const assetIdByKey = new Map<string, string>(); // key → asset_id
  const newAssets: Array<Record<string, unknown>> = [];

  for (const [key, asset] of canonicalByKey) {
    const existingId = existingUrls.get(key);
    if (existingId) {
      assetIdByKey.set(key, existingId);
      continue;
    }
    // Don't double-insert within the batch
    if (assetIdByKey.has(key)) continue;

    newAssets.push({
      product_spu_id: asset.product_spu_id,
      asset_type: 'image',
      asset_url: asset.asset_url,
      position: asset.position,
      source_system: 'product_master',
      raw_payload: asset.raw_payload,
    });
    assetIdByKey.set(key, '__pending__'); // placeholder
  }

  // Insert new assets in batches
  if (newAssets.length > 0) {
    const batchSize = 500;
    for (let offset = 0; offset < newAssets.length; offset += batchSize) {
      const batch = newAssets.slice(offset, offset + batchSize);
      const { data, error } = await supabase.from('product_assets').insert(batch).select('id, product_spu_id, asset_url');

      if (error) {
        console.error(`Assets insert batch ${offset}: ${error.message}`);
      } else {
        assetCount += (data ?? []).length;
        for (const row of (data ?? [])) {
          const key = `${row.product_spu_id}::${row.asset_url}`;
          assetIdByKey.set(key, row.id as string);
        }
      }
    }
  }

  // Upsert variant→image links into junction table
  const linksToInsert: Array<Record<string, unknown>> = [];
  for (const link of variantLinks) {
    const key = `${link.spu_id ?? '__no_spu__'}::${link.asset_url}`;
    const imageId = assetIdByKey.get(key);
    if (!imageId || imageId === '__pending__') continue; // skip if asset insert failed

    linksToInsert.push({
      image_id: imageId,
      product_spu_id: link.spu_id,
      variant_id: link.variant_id,
      item_code: link.item_code,
      position: link.position,
    });
  }

  if (linksToInsert.length > 0) {
    let linkCount = 0;
    const linkBatchSize = 500;
    for (let offset = 0; offset < linksToInsert.length; offset += linkBatchSize) {
      const batch = linksToInsert.slice(offset, offset + linkBatchSize);
      const { error } = await supabase
        .from('product_image_links')
        .upsert(batch, { onConflict: 'image_id,variant_id,position', ignoreDuplicates: true });

      if (error) {
        console.error(`Image links batch ${offset}: ${error.message}`);
      } else {
        linkCount += batch.length;
      }
    }
    console.log(`  Image links: ${linkCount} upserted`);
  }

  return assetCount;
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
