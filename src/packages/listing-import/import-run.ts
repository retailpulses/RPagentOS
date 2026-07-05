import { supabase } from '../../lib/supabase.js';
import type { ImportRow, ImportRun, SourceSystem } from './types.js';
import { computeRowHash } from './parse-source-file.js';

/**
 * Create a new source_import_run and return its ID.
 * The run starts in 'running' status.
 */
export async function createImportRun(params: {
  sourceSystem: SourceSystem;
  platform?: string;
  shopCode?: string;
  sourceFile: string;
  fileHash: string;
  rowCount: number;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  const { data, error } = await supabase
    .from('source_import_runs')
    .insert({
      source_system: params.sourceSystem,
      platform: params.platform ?? null,
      shop_code: params.shopCode ?? null,
      source_file: params.sourceFile,
      file_hash: params.fileHash,
      row_count: params.rowCount,
      status: 'running',
      metadata: params.metadata ?? {},
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to create import run: ${error.message}`);
  return data.id;
}

/**
 * Finish an import run: update status and timestamp.
 */
export async function finishImportRun(
  runId: string,
  status: 'completed' | 'failed' | 'partial',
): Promise<void> {
  const { error } = await supabase
    .from('source_import_runs')
    .update({ status, finished_at: new Date().toISOString() })
    .eq('id', runId);

  if (error) throw new Error(`Failed to finish import run ${runId}: ${error.message}`);
}

/**
 * Store raw rows losslessly in source_import_rows.
 *
 * Idempotency: rows are upserted by (run_id, row_index).
 * Re-running the same import does not create duplicates.
 *
 * Returns the number of rows stored.
 * Errors during individual row inserts are collected and logged;
 * rows whose upsert succeeds are counted.
 */
export async function storeRawRows(
  runId: string,
  rawRows: Record<string, string>[],
  options?: { sourceKeyField?: string },
): Promise<{ stored: number; errors: number }> {
  const batchSize = 500;
  let stored = 0;
  let errors = 0;

  for (let offset = 0; offset < rawRows.length; offset += batchSize) {
    const batch = rawRows.slice(offset, offset + batchSize);
    const rows: Array<{
      run_id: string;
      row_index: number;
      source_key: string | null;
      row_hash: string;
      raw_row: Record<string, string>;
      normalized_status: string;
    }> = batch.map((rawRow, i) => {
      const idx = offset + i;
      const sourceKey = options?.sourceKeyField
        ? (rawRow[options.sourceKeyField] || null)
        : null;
      return {
        run_id: runId,
        row_index: idx,
        source_key: sourceKey,
        row_hash: computeRowHash(rawRow as Record<string, unknown>),
        raw_row: rawRow,
        normalized_status: 'pending',
      };
    });

    const { error } = await supabase.from('source_import_rows').upsert(rows, {
      onConflict: 'run_id,row_index',
      ignoreDuplicates: false,
    });

    if (error) {
      errors += batch.length;
      console.error(`Batch ${offset}-${offset + batch.length}: ${error.message}`);
    } else {
      stored += batch.length;
    }
  }

  return { stored, errors };
}

/**
 * Mark a single source_import_row as normalized or errored.
 */
export async function updateRowStatus(
  runId: string,
  rowIndex: number,
  status: 'normalized' | 'error',
  errorMessage?: string,
): Promise<void> {
  const { error } = await supabase
    .from('source_import_rows')
    .update({
      normalized_status: status,
      error_message: errorMessage ?? null,
    })
    .eq('run_id', runId)
    .eq('row_index', rowIndex);

  if (error) {
    console.error(`Failed to update row ${rowIndex} status: ${error.message}`);
  }
}

/**
 * Check if a file has already been imported successfully.
 * Returns the existing run ID if found, null otherwise.
 */
export async function findExistingRun(
  sourceSystem: SourceSystem,
  fileHash: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('source_import_runs')
    .select('id')
    .eq('source_system', sourceSystem)
    .eq('file_hash', fileHash)
    .eq('status', 'completed')
    .order('finished_at', { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) return null;
  return data[0].id;
}
