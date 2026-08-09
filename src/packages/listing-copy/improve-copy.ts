import { createHash } from 'crypto';
import {
  type CopyMode,
  type CopyImproveOptions,
  type CopyImproveConfig,
  type ListingRow,
  type WorkItemRow,
  type CopyProposal,
  type CopyProposalResult,
  type ApplyResult,
  type FinalizationSummary,
  type ContentUpdateOutcome,
  type ApplyContentUpdateOptions,
} from './types.js';
import { buildCopyImprovementPrompt, PROMPT_PROFILE, PROMPT_VERSION } from './copy-prompts.js';

const DEFAULT_OLLAMA_URL = process.env['OLLAMA_BASE_URL'] ?? 'http://127.0.0.1:11434';
const DEFAULT_MODEL = process.env['LISTING_QWEN_MODEL'] ?? 'qwen3.5:9b';

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((k) => `${JSON.stringify(k)}:${stableJson(record[k])}`).join(',')}}`;
}

function hash(value: unknown): string {
  return createHash('sha256').update(typeof value === 'string' ? value : stableJson(value)).digest('hex');
}

export function buildConfig(): CopyImproveConfig {
  const enabled = process.env['COPY_IMPROVEMENT_ENABLED'] === 'true';
  const autoShopsRaw = process.env['COPY_IMPROVEMENT_AUTO_SHOPS'] ?? '';
  const autoShops = new Set(
    autoShopsRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const confidenceThreshold = Number(process.env['COPY_IMPROVEMENT_CONFIDENCE_THRESHOLD'] ?? '0.85');
  return {
    enabled,
    autoShops,
    confidenceThreshold,
    model: DEFAULT_MODEL,
    ollamaUrl: DEFAULT_OLLAMA_URL,
    promptProfile: PROMPT_PROFILE,
    promptVersion: PROMPT_VERSION,
  };
}

export function validateConfigForMode(config: CopyImproveConfig, mode: CopyMode): string | null {
  if (mode === 'dry_run') return null;
  if (!config.enabled) return 'COPY_IMPROVEMENT_ENABLED must be exactly "true" for approval/auto/apply modes';
  if (!Number.isFinite(config.confidenceThreshold) || config.confidenceThreshold < 0 || config.confidenceThreshold > 1) {
    return 'COPY_IMPROVEMENT_CONFIDENCE_THRESHOLD must be a number between 0 and 1';
  }
  if (mode === 'auto' && config.autoShops.size === 0) return 'COPY_IMPROVEMENT_AUTO_SHOPS must be a non-empty comma-separated shop allowlist for auto mode';
  return null;
}

export function parseLimit(raw: unknown, defaultLimit = 10, maxLimit = 20): number {
  if (typeof raw !== 'string') return defaultLimit;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return defaultLimit;
  return Math.min(n, maxLimit);
}

const PROHIBITED_CLAIMS = ['no.1', 'ナンバーワン', '最安', '絶対', '完全防水', '医療', '治療', '永久保証'];

function extractNumericTokens(text: string): string[] {
  const matches = text.match(/\d+(?:\.\d+)?\s?(?:cm|mm|kg|g|l|ml|L|W|V|kW|個|枚|台|色|年|ヶ月|畳|キロ|センチ|リットル)/g);
  return Array.from(new Set(matches ?? []));
}

export function validateProposal(
  proposal: CopyProposal,
  sourceTitle: string | null,
  sourceDescription: string | null,
  trustedFactsText = '',
): string[] {
  const errors: string[] = [];
  if (typeof proposal !== 'object' || proposal === null) return ['proposal must be an object'];

  if (typeof proposal.confidence !== 'number' || !Number.isFinite(proposal.confidence) || proposal.confidence < 0 || proposal.confidence > 1) {
    errors.push('confidence must be a number between 0 and 1');
  }

  if (typeof proposal.rationale !== 'string' || !proposal.rationale.trim()) {
    errors.push('rationale must be a non-empty string');
  }

  const hasMaterialChange =
    (proposal.title !== null && proposal.title !== sourceTitle) ||
    (proposal.description !== null && proposal.description !== sourceDescription);

  const titleBlank = proposal.title !== null && (typeof proposal.title !== 'string' || !proposal.title.trim());
  const descBlank = proposal.description !== null && (typeof proposal.description !== 'string' || !proposal.description.trim());
  if (titleBlank) errors.push('suggested title must not be blank when non-null');
  if (descBlank) errors.push('suggested description must not be blank when non-null');
  if (typeof proposal.title === 'string' && [...proposal.title].length > 127) {
    errors.push('suggested title exceeds 127 characters');
  }
  if (typeof proposal.description === 'string' && [...proposal.description].length > 5000) {
    errors.push('suggested description exceeds 5000 characters');
  }

  if (!titleBlank && !descBlank && !hasMaterialChange) {
    errors.push('proposal makes no material change to title or description');
  }

  const sourceText = [sourceTitle ?? '', sourceDescription ?? '', trustedFactsText].join('\n').toLowerCase();
  const generatedText = [proposal.title ?? '', proposal.description ?? ''].join('\n').toLowerCase();

  for (const token of extractNumericTokens(generatedText)) {
    if (!sourceText.includes(token.toLowerCase())) {
      errors.push(`Generated copy includes unsourced numeric fact: ${token}`);
    }
  }

  for (const claim of PROHIBITED_CLAIMS) {
    if (generatedText.includes(claim)) {
      errors.push(`Generated copy includes prohibited claim: ${claim}`);
    }
  }

  return errors;
}

export function parseProposalFromLLM(text: string): { proposal: CopyProposal | null; errors: string[] } {
  const trimmed = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { parsed = JSON.parse(trimmed.slice(start, end + 1)); } catch { return { proposal: null, errors: ['Qwen response was not valid JSON'] }; }
    } else {
      return { proposal: null, errors: ['Qwen response was not valid JSON'] };
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { proposal: null, errors: ['Response is not a JSON object'] };
  }
  const obj = parsed as Record<string, unknown>;

  const title = typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim() : null;
  const description = typeof obj.description === 'string' && obj.description.trim() ? obj.description.trim() : null;
  const confidence = typeof obj.confidence === 'number' ? obj.confidence : null;
  const rationale = typeof obj.rationale === 'string' && obj.rationale.trim() ? obj.rationale.trim() : '';

  if (confidence === null || confidence < 0 || confidence > 1) {
    return { proposal: null, errors: ['confidence must be a number between 0 and 1'] };
  }
  if (!rationale) {
    return { proposal: null, errors: ['rationale must be a non-empty string'] };
  }

  return { proposal: { title, description, confidence, rationale }, errors: [] };
}

export type OllamaCallFn = (prompt: string, model: string) => Promise<{ content: string; error?: string }>;

export function proposalInputIdentity(
  listing: ListingRow,
  config: CopyImproveConfig,
): { prompt: string; inputHash: string } {
  const prompt = buildCopyImprovementPrompt(listing);
  return {
    prompt,
    inputHash: hash({
      profile: config.promptProfile,
      version: config.promptVersion,
      model: config.model,
      listing: listing.id,
      contentRevision: listing.content_revision,
      prompt,
    }),
  };
}

export async function callOllama(
  prompt: string,
  model: string,
  ollamaUrl: string,
  timeoutMs = Number(process.env['LISTING_QWEN_TIMEOUT_MS'] ?? '240000'),
): Promise<{ content: string; error?: string }> {
  const effectiveTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs >= 1000
    ? Math.min(timeoutMs, 900000)
    : 240000;
  const url = `${ollamaUrl.replace(/\/$/, '')}/api/chat`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), effectiveTimeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        think: false,
        format: 'json',
        options: { temperature: 0.1, num_predict: 900, num_ctx: 4096 },
      }),
      signal: controller.signal,
    });
    if (!response.ok) return { content: '', error: `Ollama ${response.status}: ${(await response.text()).slice(0, 500)}` };
    const body = await response.json() as { message?: { content?: string }; response?: string; error?: string };
    if (body.error) return { content: '', error: `Ollama error: ${body.error}` };
    return { content: body.message?.content ?? body.response ?? '' };
  } catch (err) {
    return { content: '', error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateProposal(
  listing: ListingRow,
  config: CopyImproveConfig,
  ollamaCall: OllamaCallFn,
): Promise<{ proposal: CopyProposal | null; validationStatus: CopyProposalResult['validationStatus']; validationErrors: string[]; repairAttempts: number; prompt: string; inputHash: string; outputHash: string }> {
  const { prompt, inputHash } = proposalInputIdentity(listing, config);

  let validationErrors: string[] = [];
  let repairAttempts = 0;

  for (let attempt = 0; attempt <= 1; attempt++) {
    repairAttempts = attempt;
    const attemptPrompt = attempt === 0 ? prompt : buildCopyImprovementPrompt(listing, validationErrors);
    const result = await ollamaCall(attemptPrompt, config.model);

    if (result.error) {
      const outputHash = hash(result.error);
      return { proposal: null, validationStatus: 'failed', validationErrors: [result.error], repairAttempts: attempt, prompt: attemptPrompt, inputHash, outputHash };
    }

    const parsed = parseProposalFromLLM(result.content);
    if (!parsed.proposal) {
      validationErrors = parsed.errors;
      if (attempt < 1) continue;
      const outputHash = hash(result.content);
      return { proposal: null, validationStatus: 'invalid', validationErrors, repairAttempts: attempt, prompt: attemptPrompt, inputHash, outputHash };
    }

    validationErrors = validateProposal(
      parsed.proposal,
      listing.title,
      listing.description,
      stableJson(listing.trusted_facts),
    );
    if (validationErrors.length === 0) {
      const outputHash = hash(parsed.proposal);
      const status = attempt > 0 ? 'repaired' : 'valid';
      return { proposal: parsed.proposal, validationStatus: status, validationErrors: [], repairAttempts: attempt, prompt: attemptPrompt, inputHash, outputHash };
    }

    if (attempt < 1) continue;
    const outputHash = hash(parsed.proposal);
    return { proposal: parsed.proposal, validationStatus: 'invalid', validationErrors, repairAttempts: attempt, prompt: attemptPrompt, inputHash, outputHash };
  }

  const outputHash = hash('unreachable');
  return { proposal: null, validationStatus: 'failed', validationErrors: ['exhausted repair attempts'], repairAttempts: 1, prompt, inputHash, outputHash };
}

export type ListingFetcher = (opts: { platform?: string; shopCode?: string; listingId?: string; limit: number }) => Promise<ListingRow[]>;
export type WorkItemFetcher = (targetIds: string[]) => Promise<WorkItemRow[]>;
export type WorkItemUpserter = (rows: Array<{ targetKey: string; platform: string; shopCode: string; status: string; sourceContext: Record<string, unknown> }>) => Promise<Map<string, string>>;

export async function applyContentUpdate(
  opts: ApplyContentUpdateOptions,
  internalApiUrl: string,
  internalApiToken: string,
  fetchFn: typeof fetch,
): Promise<{ outcome: ContentUpdateOutcome; contentRevision: number | null }> {
  const baseUrl = internalApiUrl.replace(/\/$/, '');
  const url = new URL(`${baseUrl}/listings/${encodeURIComponent(opts.listingId)}/content`);
  const body: Record<string, unknown> = {
    expected_content_revision: opts.expectedRevision,
    content_origin: 'ai_enhanced',
    idempotency_key: opts.idempotencyKey,
    enhancement_model: opts.model,
    enhancement_prompt_version: opts.promptVersion,
  };
  if (opts.title) body.title = opts.title;
  if (opts.description) body.description = opts.description;

  try {
    const response = await fetchFn(url, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${internalApiToken}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
    });

    const result = await response.json().catch(() => ({})) as { outcome?: string; content_revision?: number };
    if (!response.ok && result.outcome !== 'stale_revision') {
      return { outcome: 'error', contentRevision: result.content_revision ?? null };
    }
    const outcome = result.outcome;
    if (outcome === 'updated' || outcome === 'replay') {
      return { outcome, contentRevision: result.content_revision ?? null };
    }
    if (outcome === 'stale_revision') return { outcome, contentRevision: result.content_revision ?? null };
    return { outcome: 'error', contentRevision: result.content_revision ?? null };
  } catch {
    return { outcome: 'error', contentRevision: null };
  }
}

export interface SupabaseAccess {
  supabaseUrl: string;
  supabaseKey: string;
}

export function idempotencyKey(listingId: string, proposalHash: string): string {
  return `listing-copy/${listingId}/${proposalHash}`;
}
