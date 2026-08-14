// Qwen AI visual review pipeline step (Phase 3).
//
// Wraps the Qwen (Ollama) visual review for use within the automated
// review pipeline. No work-item lookup, no DB writes — those happen
// later in the pipeline. Pure call-and-parse.
//
// Uses the same Ollama HTTP call pattern as listing-intelligence/qwen-review.ts.

import type {
  Marketplace,
  QwenPipelineInput,
  QwenPipelineOutput,
  QualityIssue,
} from './types.js';

// ─── Configuration ───────────────────────────────────────────────────────────

const DEFAULT_OLLAMA_URL = process.env['OLLAMA_BASE_URL'] ?? 'http://127.0.0.1:11434';
const DEFAULT_MODEL = process.env['LISTING_IMAGE_MODEL'] ?? process.env['LISTING_QWEN_MODEL'] ?? 'qwen3.5:9b';
const DEFAULT_TIMEOUT_MS = 120_000; // 120 seconds

// ─── Ollama API helpers ──────────────────────────────────────────────────────

interface OllamaChatResponse {
  message?: { content?: string };
  model?: string;
  done?: boolean;
  error?: string;
  total_duration?: number;
}

/**
 * Call the Ollama /api/chat endpoint with a prompt and return the parsed
 * response. Throws on HTTP errors, model errors, or timeout.
 */
async function callOllama(
  prompt: string,
  model: string,
  timeoutMs: number,
): Promise<{ content: string; rawResponse: Record<string, unknown>; durationMs: number }> {
  const url = `${DEFAULT_OLLAMA_URL.replace(/\/$/, '')}/api/chat`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startTime = Date.now();

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        options: { temperature: 0.1, num_predict: 900, num_ctx: 4096 },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Ollama ${response.status}: ${await response.text()}`);
    }

    const body = (await response.json()) as OllamaChatResponse;

    if (body.error) {
      throw new Error(`Ollama error: ${body.error}`);
    }

    const content = body.message?.content ?? '';
    const durationMs = Date.now() - startTime;

    return {
      content,
      rawResponse: body as unknown as Record<string, unknown>,
      durationMs,
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ─── JSON parsing helpers ────────────────────────────────────────────────────

/**
 * Parse a JSON response from Qwen, handling markdown code fences and
 * partial JSON extraction.
 */
function parseJsonResponse(text: string): Record<string, unknown> {
  const trimmed = text.trim();

  // Remove markdown code fences if present
  const cleaned = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    throw new Error('Response is not a JSON object');
  } catch {
    // Fallback: try to extract the first { ... } block
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    }
    throw new Error('Qwen response was not valid JSON');
  }
}

// ─── Issue parsing ───────────────────────────────────────────────────────────

interface VisualIssueRaw {
  type: string;
  severity?: string;
  evidence?: string;
  affected_image_indexes?: number[];
  operator_note?: string;
}

/**
 * Convert the raw issues array from the Qwen response into QualityIssue[]
 * with source='qwen_visual'. Skips entries with missing/invalid fields.
 */
function parseQwenIssues(
  raw: Record<string, unknown>,
  marketplace: Marketplace,
): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const rawIssues = Array.isArray(raw['issues'])
    ? (raw['issues'] as VisualIssueRaw[])
    : [];

  const validSeverities = ['low', 'medium', 'high', 'critical'];

  for (const rawIssue of rawIssues) {
    if (!rawIssue.type || typeof rawIssue.type !== 'string') continue;

    const severity = rawIssue.severity ?? 'medium';
    if (!validSeverities.includes(severity)) continue;

    issues.push({
      type: rawIssue.type,
      severity: severity as QualityIssue['severity'],
      confidence: 0.7, // moderate confidence for AI-discovered issues
      source: 'qwen_visual',
      marketplace,
      affected_image_indexes: Array.isArray(rawIssue.affected_image_indexes)
        ? rawIssue.affected_image_indexes.filter(
            (i: unknown) => typeof i === 'number',
          )
        : [],
      evidence: rawIssue.evidence ?? '',
      operator_note:
        rawIssue.operator_note ??
        `Qwen AI visual review flagged: ${rawIssue.type}`,
      requires_human_approval: true,
      suggested_owner: null,
      expected_impact: null,
    });
  }

  return issues;
}

// ─── Prompt builder ──────────────────────────────────────────────────────────

/**
 * Build a visual quality review prompt for Qwen based on snapshot image data.
 * Describes each loaded image with its metadata and OCR text so Qwen can
 * reason about visual quality issues even without direct vision capability.
 */
function buildVisualReviewPrompt(input: QwenPipelineInput): string {
  const { snapshotImages, marketplace, title, description, ocrTextByIndex } =
    input;

  const loadedImages = snapshotImages.filter((img) => img.loaded);

  const imageDescriptions =
    loadedImages.length > 0
      ? loadedImages
          .map((img) => {
            const ocr =
              ocrTextByIndex[img.image_index] ?? img.ocr_text ?? '';
            const ocrPreview =
              ocr.length > 300 ? `${ocr.slice(0, 300)}...` : ocr;
            return [
              `- Image ${img.image_index}${
                img.is_main_image ? ' (MAIN)' : ''
              }:`,
              `  Dimensions: ${img.width ?? 'unknown'}×${
                img.height ?? 'unknown'
              } px`,
              `  Size: ${
                img.byte_size
                  ? `${(img.byte_size / 1024).toFixed(1)} KB`
                  : 'unknown'
              }`,
              ocrPreview
                ? `  OCR text: "${ocrPreview}"`
                : '  OCR text: (none)',
            ].join(' ');
          })
          .join('\n')
      : '(no loaded images)';

  return [
    `You are a listing image quality reviewer for the ${marketplace} marketplace.`,
    'Analyze the listing images below for visual quality issues.',
    '',
    'LISTING CONTEXT:',
    `Title: ${title ?? '(no title)'}`,
    `Description: ${description ?? '(no description)'}`,
    `Total images: ${snapshotImages.length}, Loaded: ${loadedImages.length}`,
    '',
    'IMAGES:',
    imageDescriptions,
    '',
    'INSTRUCTIONS:',
    'Review the images for these visual quality issues:',
    '1. Image quality — blurry, pixelated, low resolution (below marketplace minimum)',
    '2. Text/content issues — text overlays, watermarks, logos, forbidden claims in image text',
    '3. Missing important image types — no main shot, no lifestyle/in-context photo,',
    '   no detail closeup, no scale reference',
    '4. Image count — too few images for the marketplace standard',
    '5. Main image quality — is the main image clear and product-focused?',
    '6. Image diversity — are images distinct or are they near-duplicates?',
    '',
    'Return a JSON object with exactly this structure. No markdown, no explanation outside JSON.',
    JSON.stringify({
      issues: [
        {
          type: 'string — use existing taxonomy issue types when applicable (weak_main_image, no_lifestyle_image, no_scale_reference, no_detail_closeup, image_low_resolution, image_text_overlay, image_watermark, duplicate_content, image_count_low, missing_main_image, forbidden_claims) or a descriptive custom type',
          severity: 'low | medium | high | critical',
          evidence: 'specific evidence from the image data',
          affected_image_indexes: [0],
          operator_note: 'human-readable action note',
        },
      ],
    }),
    '',
    'IMPORTANT: Only flag issues you are confident exist based on the data provided.',
    'If all images look fine, return an empty issues array.',
  ].join('\n');
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * Run the Qwen visual review for a single listing within the automated
 * review pipeline.
 *
 * Takes snapshot images + listing context, calls Ollama Qwen, and returns
 * structured issues. This function is fail-safe: on any error (timeout,
 * model error, JSON parse failure) it returns `succeeded: false` with a
 * descriptive error message and empty issues array. The pipeline continues.
 *
 * Default timeout is 120 seconds. Configure via environment variables:
 *   OLLAMA_BASE_URL       — default http://127.0.0.1:11434
 *   LISTING_IMAGE_MODEL   — default qwen3.5:9b (legacy fallback: LISTING_QWEN_MODEL)
 */
export async function runQwenVisualReview(
  input: QwenPipelineInput,
): Promise<QwenPipelineOutput> {
  const model = input.modelName ?? DEFAULT_MODEL;
  const timeoutMs = DEFAULT_TIMEOUT_MS;
  const startTime = Date.now();

  try {
    const prompt = buildVisualReviewPrompt(input);

    const { content, rawResponse, durationMs } = await callOllama(
      prompt,
      model,
      timeoutMs,
    );

    if (!content || content.trim().length === 0) {
      return {
        issues: [],
        rawOutput: rawResponse,
        succeeded: false,
        errorMessage: 'Empty response from Qwen model',
        modelName: model,
        durationMs,
      };
    }

    const parsed = parseJsonResponse(content);
    const issues = parseQwenIssues(parsed, input.marketplace);

    return {
      issues,
      rawOutput: {
        ...parsed,
        _prompt: prompt,
        _model: model,
      },
      succeeded: true,
      errorMessage: null,
      modelName: model,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : String(err);

    return {
      issues: [],
      rawOutput: { error: errorMessage },
      succeeded: false,
      errorMessage,
      modelName: model,
      durationMs,
    };
  }
}
