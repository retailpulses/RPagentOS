import { supabase } from '../../lib/supabase.js';

/**
 * Fetch all rows from a table, paginating past Supabase's 1,000-row default limit.
 */
export async function fetchAll<T extends Record<string, unknown>>(
  table: string,
  columns: string,
  filter?: { column: string; value: unknown },
): Promise<T[]> {
  const all: T[] = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    let query = supabase.from(table).select(columns).range(offset, offset + pageSize - 1);
    if (filter) {
      query = query.eq(filter.column, filter.value);
    }
    const { data, error } = await query;

    if (error) {
      console.error(`fetchAll ${table} offset ${offset}: ${error.message}`);
      break;
    }
    if (!data || data.length === 0) break;
    all.push(...(data as unknown as T[]));
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return all;
}

/**
 * Build a lookup Map from a table's key column to its id column.
 * Handles pagination automatically.
 */
export async function buildLookup(
  table: string,
  keyColumn: string,
  idColumn: string = 'id',
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const rows = await fetchAll<Record<string, unknown>>(table, `${idColumn},${keyColumn}`);
  for (const r of rows) {
    const key = String(r[keyColumn] ?? '');
    const id = String(r[idColumn] ?? '');
    if (key && id) map.set(key, id);
  }
  return map;
}
