// Duplicate image detection within a review snapshot.
//
// Compares url_hash (same URL used multiple times) and content_hash (same
// image content at different URLs). Returns duplicate groups with affected
// image indexes for downstream issue creation.

import type { DuplicateGroup, SnapshotImage, ImageHealthResult } from './types.js';

/**
 * Detect duplicate URLs — same url_hash appearing at multiple positions.
 */
export function detectDuplicateUrls(images: Array<{ image_index: number; url_hash: string | null }>): DuplicateGroup[] {
  const byHash = new Map<string, number[]>();

  for (const img of images) {
    if (img.url_hash) {
      const existing = byHash.get(img.url_hash) ?? [];
      existing.push(img.image_index);
      byHash.set(img.url_hash, existing);
    }
  }

  const groups: DuplicateGroup[] = [];
  for (const [, indexes] of byHash) {
    if (indexes.length > 1) {
      groups.push({ image_indexes: indexes.sort((a, b) => a - b), reason: 'url_match' });
    }
  }

  return groups;
}

/**
 * Detect duplicate content — same content_hash at different URLs.
 * Only checks images that loaded successfully.
 */
export function detectDuplicateContent(images: Array<{ image_index: number; content_hash: string | null; loaded: boolean }>): DuplicateGroup[] {
  const byHash = new Map<string, number[]>();

  for (const img of images) {
    if (img.loaded && img.content_hash) {
      const existing = byHash.get(img.content_hash) ?? [];
      existing.push(img.image_index);
      byHash.set(img.content_hash, existing);
    }
  }

  const groups: DuplicateGroup[] = [];
  for (const [, indexes] of byHash) {
    if (indexes.length > 1) {
      groups.push({ image_indexes: indexes.sort((a, b) => a - b), reason: 'content_match' });
    }
  }

  return groups;
}

/**
 * Run all duplicate detection on a set of health check results.
 */
export function detectDuplicates(healthResults: ImageHealthResult[]): {
  urlDuplicates: DuplicateGroup[];
  contentDuplicates: DuplicateGroup[];
  allDuplicates: DuplicateGroup[];
} {
  const urlDuplicates = detectDuplicateUrls(
    healthResults.map((r) => ({ image_index: r.image_index, url_hash: r.url_hash })),
  );
  const contentDuplicates = detectDuplicateContent(
    healthResults.map((r) => ({ image_index: r.image_index, content_hash: r.content_hash, loaded: r.loaded })),
  );

  // Merge: deduplicate groups by index set
  const seen = new Set<string>();
  const allDuplicates: DuplicateGroup[] = [];

  for (const group of [...urlDuplicates, ...contentDuplicates]) {
    const key = group.image_indexes.join(',');
    if (!seen.has(key)) {
      seen.add(key);
      allDuplicates.push(group);
    }
  }

  return { urlDuplicates, contentDuplicates, allDuplicates };
}

/**
 * Identify missing image slots — gaps in image_index sequence.
 * E.g., positions [0, 1, 3, 5] → missing [2, 4].
 */
export function detectMissingSlots(images: SnapshotImage[]): number[] {
  if (images.length === 0) return [];

  const indexes = images.map((img) => img.image_index).sort((a, b) => a - b);
  const maxIndex = indexes[indexes.length - 1];
  const present = new Set(indexes);
  const missing: number[] = [];

  for (let i = 0; i <= maxIndex; i++) {
    if (!present.has(i)) {
      missing.push(i);
    }
  }

  return missing;
}
