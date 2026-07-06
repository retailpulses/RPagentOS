// Image health check — downloads each image URL via GET, records HTTP status,
// dimensions, byte size, and computes a content hash for duplicate detection.
//
// Uses sharp for dimension extraction. Falls back gracefully on any error.

import { createHash } from 'crypto';
import type { ImageHealthResult } from './types.js';

const FETCH_TIMEOUT_MS = 15_000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20 MB
const USER_AGENT = 'RPagentOS/1.0 ListingQuality';

export interface ImageFetcher {
  fetch(url: string): Promise<{ buffer: Buffer; status: number; contentType: string | null }>;
}

/**
 * Default image fetcher using native fetch (Node 18+).
 */
export const defaultFetcher: ImageFetcher = {
  async fetch(url: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        headers: { 'user-agent': USER_AGENT },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_BYTES) {
        throw new Error(`Image too large: ${contentLength} bytes (max ${MAX_IMAGE_BYTES})`);
      }

      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
        throw new Error(`Image too large: ${arrayBuffer.byteLength} bytes (max ${MAX_IMAGE_BYTES})`);
      }

      return {
        buffer: Buffer.from(arrayBuffer),
        status: response.status,
        contentType: response.headers.get('content-type'),
      };
    } finally {
      clearTimeout(timeout);
    }
  },
};

function computeHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function computeUrlHash(url: string): string {
  return createHash('sha256').update(url).digest('hex');
}

/**
 * Run health check on a single image URL.
 * Downloads via GET, extracts dimensions with sharp, computes hashes.
 */
export async function checkImageHealth(
  imageUrl: string,
  imageIndex: number,
  fetcher: ImageFetcher = defaultFetcher,
): Promise<ImageHealthResult> {
  const urlHash = computeUrlHash(imageUrl);

  try {
    const { buffer, status } = await fetcher.fetch(imageUrl);

    // Extract dimensions with sharp (lazy-loaded so sharp is optional at import time)
    let width: number | null = null;
    let height: number | null = null;
    try {
      const sharp = (await import('sharp')).default;
      const metadata = await sharp(buffer).metadata();
      width = metadata.width ?? null;
      height = metadata.height ?? null;
    } catch {
      // sharp failed — non-fatal, dimensions stay null
    }

    const contentHash = computeHash(buffer);

    return {
      image_index: imageIndex,
      image_url: imageUrl,
      loaded: true,
      http_status: status,
      width,
      height,
      byte_size: buffer.length,
      content_hash: contentHash,
      url_hash: urlHash,
      load_error: null,
    };
  } catch (err) {
    return {
      image_index: imageIndex,
      image_url: imageUrl,
      loaded: false,
      http_status: null,
      width: null,
      height: null,
      byte_size: null,
      content_hash: null,
      url_hash: urlHash,
      load_error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Run health checks on a batch of image URLs.
 * Images are checked sequentially to avoid overwhelming the source server.
 */
export async function checkImageHealthBatch(
  imageUrls: Array<{ url: string; index: number }>,
  options: { concurrency?: number; fetcher?: ImageFetcher } = {},
): Promise<ImageHealthResult[]> {
  const results: ImageHealthResult[] = [];
  const concurrency = options.concurrency ?? 1;
  const fetcher = options.fetcher ?? defaultFetcher;

  for (let i = 0; i < imageUrls.length; i += concurrency) {
    const batch = imageUrls.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map((img) => checkImageHealth(img.url, img.index, fetcher)),
    );
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        const idx = batch[batchResults.indexOf(result as PromiseSettledResult<ImageHealthResult>)].index;
        results.push({
          image_index: idx,
          image_url: imageUrls.find((u) => u.index === idx)?.url ?? '',
          loaded: false,
          http_status: null,
          width: null,
          height: null,
          byte_size: null,
          content_hash: null,
          url_hash: '',
          load_error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    }
  }

  return results;
}
