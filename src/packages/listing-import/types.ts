// Shared types for the listing-import package

export type SourceSystem = 'product_master' | 'mercari' | 'rakuten' | 'amazon' | 'amazon_mapping';
export type ImportStatus = 'running' | 'completed' | 'failed' | 'partial';
export type RowNormalizedStatus = 'pending' | 'normalized' | 'error' | 'skipped';

export interface ImportRun {
  id: string;
  source_system: string;
  platform?: string;
  shop_code?: string;
  source_file: string;
  file_hash: string;
  row_count: number;
  status: ImportStatus;
  started_at?: string;
  finished_at?: string;
  metadata?: Record<string, unknown>;
}

export interface ImportRow {
  id: string;
  run_id: string;
  row_index: number;
  source_key?: string;
  row_hash: string;
  raw_row: Record<string, unknown>;
  normalized_status: RowNormalizedStatus;
  error_message?: string;
  created_at?: string;
}

export interface ParseResult {
  rows: Record<string, string>[];
  rowCount: number;
  fileHash: string;
  columns: string[];
}

// Platform account seed data
export interface PlatformAccountSeed {
  platform: string;
  shop_code: string;
  display_name: string;
}

export const PLATFORM_ACCOUNTS: PlatformAccountSeed[] = [
  { platform: 'mercari', shop_code: 'shop4', display_name: 'Mercari Shop4' },
  { platform: 'rakuten', shop_code: 'homebliss', display_name: 'Rakuten Homebliss' },
  { platform: 'amazon', shop_code: 'jp', display_name: 'Amazon Japan' },
];
