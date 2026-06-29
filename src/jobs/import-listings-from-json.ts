import { readFileSync } from 'fs';
import { supabase } from '../lib/supabase.js';
import { createAgentRun, completeAgentRun } from '../lib/agent-run.js';

const PLATFORM = process.env['AGENT_OS_TARGET_PLATFORM'] || 'mercari';
const SHOP = process.env['AGENT_OS_TARGET_SHOP'] || 'shop4';

const VALID_LISTING_STATUSES = ['active', 'inactive', 'sold_out', 'draft'];

interface ListingRow {
  spu_code?: string;
  product_title?: string;
  category?: string;
  sku?: string;
  variant_name?: string;
  color?: string;
  size_text?: string | null;
  platform?: string;
  shop_code?: string;
  external_listing_id?: string;
  listing_title?: string;
  url?: string;
  current_price?: number;
  stock_qty?: number;
  listing_status?: string;
  raw_payload?: Record<string, unknown>;
}

function parseArgs(argv: string[]): { file: string } {
  const fileArg = argv.find(a => a.startsWith('--file='));
  return { file: fileArg ? fileArg.split('=')[1] : 'data/sample-shop4-listings.json' };
}

function validateRow(row: ListingRow): string[] {
  const errors: string[] = [];

  const requiredText: [string, string | undefined][] = [
    ['spu_code', row.spu_code],
    ['product_title', row.product_title],
    ['sku', row.sku],
    ['platform', row.platform],
    ['shop_code', row.shop_code],
    ['external_listing_id', row.external_listing_id],
    ['listing_title', row.listing_title],
    ['listing_status', row.listing_status],
  ];

  for (const [name, value] of requiredText) {
    if (!value || (typeof value === 'string' && value.trim() === '')) {
      errors.push(`missing ${name}`);
    }
  }

  if (row.current_price === undefined || row.current_price === null || typeof row.current_price !== 'number' || row.current_price < 0) {
    errors.push('invalid current_price');
  }

  if (row.stock_qty === undefined || row.stock_qty === null || !Number.isInteger(row.stock_qty) || row.stock_qty < 0) {
    errors.push('invalid stock_qty');
  }

  if (row.listing_status && !VALID_LISTING_STATUSES.includes(row.listing_status)) {
    errors.push(`invalid listing_status "${row.listing_status}"`);
  }

  return errors;
}

async function recordImportError(
  runId: string,
  sourceFile: string,
  rowIndex: number,
  rawRow: Record<string, unknown>,
  errorMessage: string,
) {
  await supabase.from('import_errors').insert({
    run_id: runId,
    source_file: sourceFile,
    row_index: rowIndex,
    raw_row: rawRow,
    error_message: errorMessage,
  });
}

async function main() {
  const { file } = parseArgs(process.argv);

  let rows: ListingRow[];
  try {
    const content = readFileSync(file, 'utf-8');
    rows = JSON.parse(content) as ListingRow[];
    if (!Array.isArray(rows)) {
      console.error(`ERROR: ${file} must contain a JSON array`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`ERROR: failed to read or parse ${file}`, err);
    process.exit(1);
  }

  const run = await createAgentRun({
    runType: 'listing_import_json',
    targetPlatform: PLATFORM,
    targetShopCode: SHOP,
    metadata: { source_file: file, importer: 'import-listings-from-json' },
  });

  const runId = run.id;
  console.log(`Importing ${rows.length} listings from ${file}...`);
  console.log(`run_id: ${runId}`);

  const stats = {
    products_created: 0,
    products_updated: 0,
    variants_created: 0,
    variants_updated: 0,
    listings_created: 0,
    listings_updated: 0,
    errors: 0,
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const index = i + 1;

    // ── pre-validation: fail early, no partial write ──
    const validationErrors = validateRow(row);
    if (validationErrors.length > 0) {
      const msg = `Validation failed: ${validationErrors.join(', ')}`;
      console.error(`  [${index}] SKIP: ${msg}`);
      stats.errors++;
      await recordImportError(runId, file, index, row as unknown as Record<string, unknown>, msg);
      continue;
    }

    try {
      // ── a. products ──────────────────────────────────
      const { data: existingProduct } = await supabase
        .from('products')
        .select('id')
        .eq('spu_code', row.spu_code)
        .maybeSingle();

      if (existingProduct) {
        await supabase
          .from('products')
          .update({
            title: row.product_title,
            category: row.category ?? undefined,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingProduct.id);
        stats.products_updated++;
      } else {
        await supabase.from('products').insert({
          spu_code: row.spu_code,
          title: row.product_title,
          category: row.category ?? null,
          status: 'active',
        });
        stats.products_created++;
      }

      // ── b. product_variants ──────────────────────────
      const { data: existingVariant } = await supabase
        .from('product_variants')
        .select('id, product_id')
        .eq('sku', row.sku)
        .maybeSingle();

      if (existingVariant) {
        await supabase
          .from('product_variants')
          .update({
            variant_name: row.variant_name ?? undefined,
            color: row.color ?? undefined,
            size_text: row.size_text ?? undefined,
          })
          .eq('id', existingVariant.id);
        stats.variants_updated++;
      } else {
        const { data: prod } = await supabase
          .from('products')
          .select('id')
          .eq('spu_code', row.spu_code)
          .maybeSingle();

        if (!prod) {
          const msg = `product not found for spu_code=${row.spu_code}`;
          console.error(`  [${index}] SKIP: ${msg}`);
          stats.errors++;
          await recordImportError(runId, file, index, row as unknown as Record<string, unknown>, msg);
          continue;
        }

        await supabase.from('product_variants').insert({
          product_id: prod.id,
          sku: row.sku,
          variant_name: row.variant_name ?? null,
          color: row.color ?? null,
          size_text: row.size_text ?? null,
          status: 'active',
        });
        stats.variants_created++;
      }

      // ── c. platform_listings ─────────────────────────
      const updateData: Record<string, unknown> = {
        title: row.listing_title,
        url: row.url ?? undefined,
        current_price: row.current_price,
        stock_qty: row.stock_qty,
        listing_status: row.listing_status,
        raw_payload: row.raw_payload ?? undefined,
        updated_at: new Date().toISOString(),
      };

      const { data: existingListing } = await supabase
        .from('platform_listings')
        .select('id')
        .eq('platform', row.platform)
        .eq('shop_code', row.shop_code)
        .eq('external_listing_id', row.external_listing_id)
        .maybeSingle();

      if (existingListing) {
        await supabase
          .from('platform_listings')
          .update(updateData)
          .eq('id', existingListing.id);
        stats.listings_updated++;
      } else {
        const { data: v } = await supabase
          .from('product_variants')
          .select('id')
          .eq('sku', row.sku)
          .maybeSingle();

        if (!v) {
          const msg = `variant not found for sku=${row.sku}`;
          console.error(`  [${index}] SKIP: ${msg}`);
          stats.errors++;
          await recordImportError(runId, file, index, row as unknown as Record<string, unknown>, msg);
          continue;
        }

        await supabase.from('platform_listings').insert({
          variant_id: v.id,
          platform: row.platform,
          shop_code: row.shop_code,
          external_listing_id: row.external_listing_id,
          title: row.listing_title,
          current_price: row.current_price,
          stock_qty: row.stock_qty,
          listing_status: row.listing_status,
          url: row.url ?? null,
          raw_payload: row.raw_payload ?? null,
        });
        stats.listings_created++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [${index}] UNEXPECTED ERROR for sku=${row.sku}: ${msg}`);
      stats.errors++;
      await recordImportError(runId, file, index, row as unknown as Record<string, unknown>, msg);
    }
  }

  await completeAgentRun(runId, {
    importer: 'import-listings-from-json',
    source_file: file,
    products_created: stats.products_created,
    products_updated: stats.products_updated,
    variants_created: stats.variants_created,
    variants_updated: stats.variants_updated,
    listings_created: stats.listings_created,
    listings_updated: stats.listings_updated,
    errors_count: stats.errors,
  });

  console.log('');
  console.log('Import complete:');
  console.log(`  run_id:               ${runId}`);
  console.log(`  source_file:          ${file}`);
  console.log(`  products_created:     ${stats.products_created}`);
  console.log(`  products_updated:     ${stats.products_updated}`);
  console.log(`  variants_created:     ${stats.variants_created}`);
  console.log(`  variants_updated:     ${stats.variants_updated}`);
  console.log(`  listings_created:     ${stats.listings_created}`);
  console.log(`  listings_updated:     ${stats.listings_updated}`);
  console.log(`  errors:               ${stats.errors}`);
}

main();
