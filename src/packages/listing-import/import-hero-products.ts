import { supabase } from '../../lib/supabase.js';
import { readFileSync } from 'fs';

interface HeroCsvRow {
  title: string;
  spu_code: string;
  item_codes: string;
}

/**
 * Import hero products from hero-products.csv into merchandising_focus_items.
 *
 * CSV columns: title, spu_code, item_codes
 * - spu_code → product_spus.spu_code (lookup)
 * - item_codes stored in strategy_note for cross-reference
 * - focus_type = 'hero'
 */
export async function importHeroProducts(): Promise<{
  rows: number;
  matched: number;
  unmatched: string[];
  inserted: number;
}> {
  console.log('\n=== Importing Hero Products ===\n');

  const raw = readFileSync('data/product and listings/hero-products.csv', 'utf-8');
  const lines = raw.trim().split('\n');

  // Parse CSV (handles simple commas; item_codes may contain ", " separators within the field)
  const rows: HeroCsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    if (fields.length >= 2) {
      rows.push({
        title: fields[0] || '',
        spu_code: fields[1] || '',
        item_codes: fields[2] || '',
      });
    }
  }

  const nonEmpty = rows.filter((r) => r.spu_code);
  console.log(`Parsed ${nonEmpty.length} rows with spu_code`);

  // Lookup SPU IDs
  const spuCodes = nonEmpty.map((r) => r.spu_code);
  const { data: spus, error: spuError } = await supabase
    .from('product_spus')
    .select('id,spu_code')
    .in('spu_code', spuCodes);

  if (spuError) throw spuError;

  const spuIdByCode = new Map<string, string>();
  for (const s of spus!) spuIdByCode.set(s.spu_code, s.id);
  console.log(`Matched ${spuIdByCode.size} / ${spuCodes.length} SPU codes`);

  const unmatched = spuCodes.filter((c) => !spuIdByCode.has(c));

  // Build insert rows
  const inserts = nonEmpty
    .filter((r) => spuIdByCode.has(r.spu_code))
    .map((r) => ({
      focus_type: 'hero',
      product_spu_id: spuIdByCode.get(r.spu_code)!,
      priority: 100,
      strategy_note: r.item_codes || null,
      status: 'active',
    }));

  // Upsert in batches (unique on focus_type + product_spu_id)
  let inserted = 0;
  const batchSize = 100;
  for (let offset = 0; offset < inserts.length; offset += batchSize) {
    const batch = inserts.slice(offset, offset + batchSize);
    const { error } = await supabase
      .from('merchandising_focus_items')
      .upsert(batch, {
        onConflict: 'focus_type,product_spu_id',
        ignoreDuplicates: false,
      });

    if (error) {
      console.error(`Batch ${offset}: ${error.message}`);
    } else {
      inserted += batch.length;
    }
  }

  console.log(`Inserted ${inserted} hero focus items`);
  if (unmatched.length > 0) {
    console.log(`Unmatched spu_codes (${unmatched.length}):`, unmatched);
  }

  return {
    rows: nonEmpty.length,
    matched: spuIdByCode.size,
    unmatched,
    inserted,
  };
}

/**
 * Simple CSV line parser — handles quoted fields.
 */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const ch of line) {
    if (inQuotes) {
      if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}
