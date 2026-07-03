import { extname } from 'path';
import type { ListingAuditInput } from './types.js';
import { normalizePlatform } from './audit.js';

export function parseListingAuditFile(content: string, filePath: string): ListingAuditInput[] {
  const extension = extname(filePath).toLowerCase();

  if (extension === '.csv') {
    return parseCsv(content).map((row, index) => normalizeRow(row, index));
  }

  const parsed = JSON.parse(content) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('listing audit input must be a JSON array or CSV file');
  }

  return parsed.map((row, index) => normalizeRow(asRecord(row), index));
}

function normalizeRow(row: Record<string, unknown>, index: number): ListingAuditInput {
  const rawPayload = asRecord(row['raw_payload'] ?? row['rawPayload'] ?? row['product_facts'] ?? {});
  const raw = { ...rawPayload, ...row };
  const listingId = firstText(row, ['listing_id', 'listingId', 'external_listing_id', 'externalListingId', 'id']) ?? `row-${index + 1}`;

  return {
    listingId,
    platform: normalizePlatform(firstText(row, ['platform'])),
    shopCode: firstText(row, ['shop_code', 'shopCode']),
    sku: firstText(row, ['sku', 'SKU']),
    title: firstText(row, ['listing_title', 'listingTitle', 'title', 'product_title', 'productTitle']) ?? '',
    description: firstText(row, ['description', 'listing_description', 'listingDescription']),
    price: firstNumber(row, ['current_price', 'currentPrice', 'price', '販売価格']),
    stockQty: firstInteger(row, ['stock_qty', 'stockQty', 'stock', '在庫数']),
    listingStatus: firstText(row, ['listing_status', 'listingStatus', 'status']),
    category: firstText(row, ['category', 'カテゴリ']),
    url: firstText(row, ['url', 'listing_url', 'listingUrl']),
    imageUrls: firstStringList(row, ['image_urls', 'imageUrls', 'image_paths', 'imagePaths']),
    raw,
  };
}

function parseCsv(content: string): Record<string, unknown>[] {
  const rows = parseCsvRows(content);
  if (rows.length === 0) return [];

  const [headers, ...dataRows] = rows;
  return dataRows
    .filter(row => row.some(cell => cell.trim() !== ''))
    .map(row => Object.fromEntries(headers.map((header, index) => [header.trim(), row[index] ?? ''])));
}

function parseCsvRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const next = content[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i++;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some(value => value.trim() !== '')) rows.push(row);
  return rows;
}

function firstText(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

function firstNumber(row: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value.replace(/[,¥￥]/g, ''));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function firstInteger(row: Record<string, unknown>, keys: string[]): number | undefined {
  const value = firstNumber(row, keys);
  return value === undefined ? undefined : Math.trunc(value);
}

function firstStringList(row: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = row[key];
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
    if (typeof value === 'string' && value.trim() !== '') {
      return value.split(/[|;]/).map(item => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
