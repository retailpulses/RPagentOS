// OCR extraction adapter for listing image quality review.
//
// Uses local Tesseract via child process (spawn, pipe stdin).
// Adapter interface allows swapping to cloud OCR later without changing
// business logic.

import { spawn } from 'child_process';
import type { OcrResult } from './types.js';

const TESSERACT_TIMEOUT_MS = 30_000;
const OCR_MAX_TEXT_LENGTH = 1000;
const DEFAULT_LANG = 'jpn+eng';

function spawnTesseract(
  imageBuffer: Buffer,
  lang: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('tesseract', ['stdin', 'stdout', '-l', lang, '--psm', '6'], {
      timeout: timeoutMs,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    child.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      // Tesseract exits with code 1 for "no text found" — that's valid
      if (code === 0 || (code === 1 && stderr.includes('Empty page'))) {
        resolve(stdout);
      } else if (code === 1) {
        // No text found but not an error
        resolve('');
      } else {
        reject(new Error(`Tesseract exited with code ${code}: ${stderr}`));
      }
    });

    child.on('error', reject);

    child.stdin.write(imageBuffer);
    child.stdin.end();
  });
}

export interface OcrEngineAdapter {
  extractText(imageBuffer: Buffer, options?: OcrOptions): Promise<OcrResult>;
}

export interface OcrOptions {
  lang?: string;
  timeoutMs?: number;
}

/**
 * Tesseract OCR adapter — extracts Japanese + English text from image buffers.
 */
export const tesseractAdapter: OcrEngineAdapter = {
  async extractText(imageBuffer: Buffer, options: OcrOptions = {}): Promise<OcrResult> {
    const lang = options.lang ?? DEFAULT_LANG;
    const timeoutMs = options.timeoutMs ?? TESSERACT_TIMEOUT_MS;

    try {
      const stdout = await spawnTesseract(imageBuffer, lang, timeoutMs);

      const text = stdout.replace(/\s+/g, ' ').trim().slice(0, OCR_MAX_TEXT_LENGTH);

      return {
        image_index: -1, // caller fills in
        ocr_text: text,
        ocr_blocks: [],
        ocr_engine: 'tesseract',
        error: null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        image_index: -1,
        ocr_text: '',
        ocr_blocks: [],
        ocr_engine: 'tesseract',
        error: message,
      };
    }
  },
};

/**
 * Extract OCR text for a single snapshot image.
 */
export async function runOcrForImage(
  imageBuffer: Buffer,
  imageIndex: number,
  adapter: OcrEngineAdapter = tesseractAdapter,
): Promise<OcrResult> {
  const result = await adapter.extractText(imageBuffer);
  result.image_index = imageIndex;
  return result;
}

/**
 * Detect keyword categories from OCR text.
 * Follows the detection pattern from tools/two-pass-rakuten-image-review-qwen.py.
 */
export function detectOcrKeywords(text: string): {
  has_dimension_text: boolean;
  has_lifestyle_words: boolean;
  has_detail_words: boolean;
  has_claim_words: boolean;
} {
  const combined = text.toLowerCase();
  return {
    has_dimension_text: /(cm|mm|幅|奥行|高さ|サイズ|寸法|直径|長さ|厚さ|重さ|重量)/i.test(combined),
    has_lifestyle_words: /(使用|暮らし|リビング|室内|屋外|旅行|収納|介護|子供|キッズ|シーン|イメージ)/i.test(combined),
    has_detail_words: /(素材|材質|pu|レザー|スチール|木製|キャスター|ロック|調整|耐荷重|防錆|防水|仕様|構造)/i.test(combined),
    has_claim_words: /(保証|防水|防錆|耐荷重|uv|紫外線|tsa|安全|高品質|最適|おすすめ|人気)/i.test(combined),
  };
}
