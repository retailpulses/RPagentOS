import { supabase } from '../../lib/supabase.js';
import { fetchAll } from './supabase-helpers.js';

interface LinkRow {
  product_family_id: string | null;
  product_spu_id: string | null;
  variant_id: string | null;
  listing_id: string;
  listing_sku_id: string | null;
  platform: string;
  shop_code: string;
  match_method: string;
  confidence: number;
}

/**
 * Resolve product-platform links across all imported data.
 *
 * Strategy (per the import plan):
 * 1. Mercari: product_master.Mercari Shop4 Product ID → platform_listings.external_listing_id
 *              product_master.item_code → platform_listing_skus.sku_code
 * 2. Rakuten: product_master.Rakuten manageNumber → platform_listings.external_listing_id
 *             product_master.RakutenSKU → platform_listing_skus.seller_sku
 * 3. Amazon: mapping.Item Code → product_variants.item_code
 *            mapping.SKU → platform_listing_skus.seller_sku
 */
export async function resolvePlatformLinks(): Promise<{
  mercariLinks: number;
  rakutenLinks: number;
  amazonLinks: number;
}> {
  console.log(`\n=== Resolving Product-Platform Links ===\n`);

  // Load all variants with their platform IDs from raw_payload
  const variants = await fetchAll<Record<string, unknown>>(
    'product_variants',
    'id,item_code,product_spu_id,raw_payload,sku',
  );
  console.log(`Loaded ${variants.length} variants`);

  // Build lookup maps
  const variantById = new Map<string, Record<string, unknown>>();
  const variantByItemCode = new Map<string, string>();   // item_code → variant_id
  const variantByShopSku = new Map<string, string>();     // shop_sku → variant_id

  for (const v of variants) {
    const vid = String(v.id);
    variantById.set(vid, v);
    const ic = String(v.item_code ?? '');
    if (ic) variantByItemCode.set(ic, vid);
    const ss = String(v.sku ?? ''); // sku = item_code (backward compat alias populated during import)
    // Also collect shop_sku from raw_payload for Amazon fallback
    const raw = v.raw_payload as Record<string, unknown> | null;
    if (raw) {
      const shopSku = String(raw['shop_sku'] ?? '');
      if (shopSku) variantByShopSku.set(shopSku, vid);
    }
  }

  // ─── Mercari Links ───────────────────────────────────────────────────

  console.log('\n--- Mercari ---');
  const mercariLinks = await resolveMercariLinks(variantById);
  console.log(`Mercari links created: ${mercariLinks}`);

  // ─── Rakuten Links ───────────────────────────────────────────────────

  console.log('\n--- Rakuten ---');
  const rakutenLinks = await resolveRakutenLinks(variantById);
  console.log(`Rakuten links created: ${rakutenLinks}`);

  // ─── Amazon Links ────────────────────────────────────────────────────

  console.log('\n--- Amazon ---');
  const amazonLinks = await resolveAmazonLinks(variantByItemCode);
  console.log(`Amazon links created: ${amazonLinks}`);

  console.log(`\n=== Link resolution complete: ${mercariLinks + rakutenLinks + amazonLinks} total links ===\n`);

  return { mercariLinks, rakutenLinks, amazonLinks };
}

// ─── Mercari ───────────────────────────────────────────────────────────

async function resolveMercariLinks(
  variantById: Map<string, Record<string, unknown>>,
): Promise<number> {
  // Load Mercari listings
  const listings = await fetchAll<Record<string, unknown>>(
    'platform_listings',
    'id,external_listing_id',
    { column: 'platform', value: 'mercari' },
  );
  const listingByExtId = new Map<string, string>();
  for (const l of listings) listingByExtId.set(String(l.external_listing_id), String(l.id));

  // Load Mercari SKUs
  const skus = await fetchAll<Record<string, unknown>>(
    'platform_listing_skus',
    'id,listing_id,sku_code',
  );
  // Filter to Mercari SKUs via listing lookup
  const mercariSkus = new Map<string, { listingId: string; skuId: string }>(); // sku_code → ...
  for (const s of skus) {
    const sc = String(s.sku_code ?? '');
    if (sc) mercariSkus.set(sc, { listingId: String(s.listing_id), skuId: String(s.id) });
  }

  // Also load SPU lookup for variants
  const spuByVariant = new Map<string, string>(); // variant_id → spu_id
  for (const [vid, v] of variantById) {
    const spuId = v.product_spu_id;
    if (spuId) spuByVariant.set(vid, String(spuId));
  }

  const links: LinkRow[] = [];

  for (const [variantId, v] of variantById) {
    const raw = v.raw_payload as Record<string, unknown> | null;
    if (!raw) continue;

    const mercariProductId = String(raw['mercari_shop4_product_id'] ?? '').trim();
    const itemCode = String(v.item_code ?? '').trim();
    const spuId = spuByVariant.get(variantId) ?? null;

    // Match 1: Mercari Shop4 Product ID → platform_listings.external_listing_id
    if (mercariProductId) {
      const listingUuid = listingByExtId.get(mercariProductId);
      if (listingUuid) {
        links.push({
          product_spu_id: spuId,
          variant_id: variantId,
          product_family_id: null,
          listing_id: listingUuid,
          listing_sku_id: null,
          platform: 'mercari',
          shop_code: 'shop4',
          match_method: 'product_master_platform_id',
          confidence: 1.0,
        });
      }
    }

    // Match 2: item_code → platform_listing_skus.sku_code
    if (itemCode) {
      const skuInfo = mercariSkus.get(itemCode);
      if (skuInfo) {
        links.push({
          product_spu_id: spuId,
          variant_id: variantId,
          product_family_id: null,
          listing_id: skuInfo.listingId,
          listing_sku_id: skuInfo.skuId,
          platform: 'mercari',
          shop_code: 'shop4',
          match_method: 'item_code',
          confidence: 0.95,
        });
      }
    }
  }

  return insertLinksBatch(links);
}

// ─── Rakuten ───────────────────────────────────────────────────────────

async function resolveRakutenLinks(
  variantById: Map<string, Record<string, unknown>>,
): Promise<number> {
  const listings = await fetchAll<Record<string, unknown>>(
    'platform_listings',
    'id,external_listing_id,manage_number',
    { column: 'platform', value: 'rakuten' },
  );
  const listingByExtId = new Map<string, string>();
  for (const l of listings) {
    const extId = String(l.external_listing_id ?? '');
    if (extId) listingByExtId.set(extId, String(l.id));
  }

  const skus = await fetchAll<Record<string, unknown>>(
    'platform_listing_skus',
    'id,listing_id,seller_sku',
  );
  const rakutenSkuBySellerSku = new Map<string, { listingId: string; skuId: string }>();
  for (const s of skus) {
    const ss = String(s.seller_sku ?? '');
    if (ss) rakutenSkuBySellerSku.set(ss, { listingId: String(s.listing_id), skuId: String(s.id) });
  }

  const spuByVariant = new Map<string, string>();
  for (const [vid, v] of variantById) {
    if (v.product_spu_id) spuByVariant.set(vid, String(v.product_spu_id));
  }

  const links: LinkRow[] = [];

  for (const [variantId, v] of variantById) {
    const raw = v.raw_payload as Record<string, unknown> | null;
    if (!raw) continue;

    const manageNumber = String(raw['rakuten_managenumber'] ?? '').trim();
    const rakutenSku = String(raw['rakutensku'] ?? '').trim();
    const spuId = spuByVariant.get(variantId) ?? null;

    // Match 1: Rakuten manageNumber → platform_listings.external_listing_id
    if (manageNumber) {
      const listingUuid = listingByExtId.get(manageNumber);
      if (listingUuid) {
        links.push({
          product_spu_id: spuId,
          variant_id: variantId,
          product_family_id: null,
          listing_id: listingUuid,
          listing_sku_id: null,
          platform: 'rakuten',
          shop_code: 'homebliss',
          match_method: 'product_master_platform_id',
          confidence: 1.0,
        });
      }
    }

    // Match 2: RakutenSKU → platform_listing_skus.seller_sku
    if (rakutenSku) {
      const skuInfo = rakutenSkuBySellerSku.get(rakutenSku);
      if (skuInfo) {
        links.push({
          product_spu_id: spuId,
          variant_id: variantId,
          product_family_id: null,
          listing_id: skuInfo.listingId,
          listing_sku_id: skuInfo.skuId,
          platform: 'rakuten',
          shop_code: 'homebliss',
          match_method: 'rakuten_sku',
          confidence: 0.95,
        });
      }
    }
  }

  return insertLinksBatch(links);
}

// ─── Amazon ────────────────────────────────────────────────────────────

async function resolveAmazonLinks(
  variantByItemCode: Map<string, string>,
): Promise<number> {
  // Load mapping rows from source_import_rows (latest amazon_mapping run)
  const { data: mappingRows } = await supabase
    .from('source_import_rows')
    .select('raw_row, run_id')
    .eq('normalized_status', 'pending')
    .order('created_at', { ascending: false })
    .limit(200);

  // Filter to amazon_mapping runs
  const mappingRunIds = new Set<string>();
  const { data: mappingRuns } = await supabase
    .from('source_import_runs')
    .select('id')
    .eq('source_system', 'amazon_mapping')
    .eq('status', 'completed')
    .order('finished_at', { ascending: false })
    .limit(1);

  let mappingEntries: Array<{ itemCode: string; sku: string }> = [];

  if (mappingRows && mappingRuns && mappingRuns.length > 0) {
    const latestRunId = mappingRuns[0].id;
    for (const row of mappingRows) {
      if (row.run_id !== latestRunId) continue;
      const raw = row.raw_row as Record<string, unknown>;
      // Normalized column names from amazon mapping CSV: id, item_code, sku
      const itemCode = String(raw['item_code'] ?? '').trim();
      const sku = String(raw['sku'] ?? '').trim();
      if (itemCode && sku) {
        mappingEntries.push({ itemCode, sku });
      }
    }
  }

  console.log(`Amazon mapping entries: ${mappingEntries.length}`);

  // Load Amazon listing SKUs
  const skus = await fetchAll<Record<string, unknown>>(
    'platform_listing_skus',
    'id,listing_id,seller_sku',
  );
  const amazonSkuBySellerSku = new Map<string, { listingId: string; skuId: string }>();
  for (const s of skus) {
    const ss = String(s.seller_sku ?? '');
    if (ss) amazonSkuBySellerSku.set(ss, { listingId: String(s.listing_id), skuId: String(s.id) });
  }

  const links: LinkRow[] = [];

  for (const mapping of mappingEntries) {
    const variantId = variantByItemCode.get(mapping.itemCode);
    const skuInfo = amazonSkuBySellerSku.get(mapping.sku);

    if (variantId && skuInfo) {
      links.push({
        product_spu_id: null,
        variant_id: variantId,
        product_family_id: null,
        listing_id: skuInfo.listingId,
        listing_sku_id: skuInfo.skuId,
        platform: 'amazon',
        shop_code: 'jp',
        match_method: 'amazon_mapping_csv',
        confidence: 1.0,
      });
    }
  }

  return insertLinksBatch(links);
}

// ─── Insert ────────────────────────────────────────────────────────────

async function insertLinksBatch(links: LinkRow[]): Promise<number> {
  if (links.length === 0) return 0;

  let inserted = 0;
  const batchSize = 200;

  for (let offset = 0; offset < links.length; offset += batchSize) {
    const batch = links.slice(offset, offset + batchSize);
    const rows = batch.map((l) => ({
      product_family_id: l.product_family_id,
      product_spu_id: l.product_spu_id,
      variant_id: l.variant_id,
      listing_id: l.listing_id,
      listing_sku_id: l.listing_sku_id,
      platform: l.platform,
      shop_code: l.shop_code,
      match_method: l.match_method,
      confidence: l.confidence,
    }));

    const { error } = await supabase
      .from('product_platform_links')
      .upsert(rows, {
        onConflict:
          'platform,shop_code,listing_id,listing_sku_id,product_family_id,product_spu_id,variant_id,bundle_id',
        ignoreDuplicates: false,
      });

    if (!error) {
      inserted += rows.length;
    } else {
      console.error(`Link batch ${offset}: ${error.message}`);
    }
  }

  return inserted;
}
