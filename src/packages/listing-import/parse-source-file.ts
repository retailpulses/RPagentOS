import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ParseResult } from './types.js';

/**
 * Detect delimiter from the first line of CSV/TSV content.
 * Returns ',' for CSV, '\t' for TSV.
 */
function detectDelimiter(headerLine: string): string {
  const tabCount = (headerLine.match(/\t/g) || []).length;
  const commaCount = (headerLine.match(/,/g) || []).length;
  return tabCount > commaCount ? '\t' : ',';
}

/**
 * Parse a single CSV/TSV line respecting quoted fields.
 * Handles: "field,with,commas", "field with ""quotes""", etc.
 */
function parseLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
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

/**
 * Normalize a column name: lowercase, trim, replace spaces/parens with underscore.
 */
function normalizeColumnName(col: string): string {
  return col
    .trim()
    .toLowerCase()
    .replace(/[\s()（）]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Compute a stable hash for a record by sorting keys alphabetically.
 */
export function hashRow(row: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(row).sort()) {
    sorted[key] = row[key];
  }
  return createHash('sha256')
    .update(JSON.stringify(sorted))
    .digest('hex')
    .substring(0, 16);
}

/**
 * Compute a stable SHA-256 hash of the full file content (first 16 chars).
 */
export function hashFile(content: string): string {
  return createHash('sha256').update(content).digest('hex').substring(0, 16);
}

/**
 * Split raw CSV/TSV content into logical lines, respecting quoted fields
 * that may contain embedded newlines.
 */
function splitCSVLines(raw: string): string[] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inQuotes) {
      current += ch;
      if (ch === '"') {
        if (i + 1 < raw.length && raw[i + 1] === '"') {
          current += raw[i + 1];
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      }
    } else {
      if (ch === '"') {
        current += ch;
        inQuotes = true;
      } else if (ch === '\n') {
        lines.push(current);
        current = '';
      } else if (ch === '\r') {
        // skip \r (handle \r\n and standalone \r)
        if (i + 1 < raw.length && raw[i + 1] === '\n') {
          // defer to \n handling — just drop the \r
        } else {
          lines.push(current);
          current = '';
        }
      } else {
        current += ch;
      }
    }
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
}

/**
 * Parse a CSV or TSV file from disk.
 *
 * - Handles UTF-8 BOM (0xEF 0xBB 0xBF)
 * - Handles embedded newlines in quoted fields
 * - Auto-detects delimiter from header line
 * - Normalizes column names (lowercase, underscores)
 * - Returns structured rows + metadata
 *
 * Accepts an explicit `delimiter` to skip auto-detection;
 * otherwise the first line is inspected for tabs vs commas.
 */
export function parseSourceFile(filePath: string, options?: { delimiter?: string }): ParseResult {
  const absolutePath = resolve(filePath);
  let raw = readFileSync(absolutePath, 'utf-8');

  // Strip UTF-8 BOM if present
  if (raw.charCodeAt(0) === 0xfeff) {
    raw = raw.slice(1);
  }

  const fileHash = hashFile(raw);

  // Split into logical lines honoring quoted newlines
  const lines = splitCSVLines(raw).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return { rows: [], rowCount: 0, fileHash, columns: [] };
  }

  const delimiter = options?.delimiter ?? detectDelimiter(lines[0]);
  const headerFields = parseLine(lines[0], delimiter);
  const columns = headerFields.map(normalizeColumnName);

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseLine(lines[i], delimiter);
    const row: Record<string, string> = {};
    for (let j = 0; j < columns.length; j++) {
      row[columns[j]] = fields[j] ?? '';
    }
    rows.push(row);
  }

  return { rows, rowCount: rows.length, fileHash, columns };
}

/**
 * Compute row hash from a raw row object using stable key ordering.
 * The raw_row must be a plain object; non-string values are accepted.
 */
export function computeRowHash(rawRow: Record<string, unknown>): string {
  return hashRow(rawRow);
}
