import { createHash } from 'crypto';
import {
  type CopyMode,
  type CopyProvider,
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
  type ListingClaimPack,
} from './types.js';
import { buildCopyImprovementPrompt, PROMPT_PROFILE, PROMPT_VERSION } from './copy-prompts.js';
import { evaluateAgainstBenchmark, findBenchmarkCopyOverlap } from './benchmark.js';
import { materializeClaimSelection } from './claim-attribution.js';

const DEFAULT_OLLAMA_URL = process.env['OLLAMA_BASE_URL'] ?? 'http://127.0.0.1:11434';

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
  const rawProvider = process.env['LISTING_COPY_PROVIDER'] ?? 'deepseek';
  if (rawProvider !== 'deepseek' && rawProvider !== 'ollama') {
    throw new Error('LISTING_COPY_PROVIDER must be ollama or deepseek');
  }
  const provider: CopyProvider = rawProvider === 'ollama' ? 'ollama' : 'deepseek';
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
    provider,
    model: process.env['LISTING_COPY_MODEL'] ?? (provider === 'deepseek' ? 'deepseek-chat' : 'qwen3.5:9b'),
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
// Only objectively checkable product facts are evidence-gated. Generic,
// non-quantified benefits (for example 安心, スムーズ, 便利, 整理しやすい)
// belong in commercial-quality review and must not fail the claim-safety gate.
const HARD_FACT_EVIDENCE_TERMS = [
  'pse', '日本仕様', '日本企画', '安全基準', '品質基準', '環境に優しい',
  '工具不要', '組立不要', '完成品', 'マスターキー',
  '機内持込', '機内持ち込み', '360度', 'キャスター', 'エンボス加工',
  'メッシュポケット', 'クロスベルト', '高さ調節', '段階調節', 'キャリーバー',
  '側面ハンドル', '底足', 'tsaロック', 'ダイヤルロック',
  'abspc', 'abs樹脂', 'pc混合樹脂',
  'ベージュ', 'ブラック', 'ホワイト', 'グレー', 'シルバー', 'レッド', 'ブルー', 'グリーン', 'ピンク',
  'abs', '樹脂',
  'アメリカ運輸保安局', '認可', '施錠したまま', 'セキュリティチェック',
  '鍵を壊さず', '鍵を傷つけず', '検査が可能',
  '静音', '消音',
];

function extractNumericTokens(text: string): string[] {
  const matches = text.match(/\d+(?:\.\d+)?\s?(?:cm|mm|kg|g|l|ml|L|W|V|kW|個|枚|台|色|種類|バリエーション|段階|年|ヶ月|日|泊|畳|キロ|センチ|リットル)/g);
  return Array.from(new Set(matches ?? []));
}

function evidenceText(evidence: ListingClaimPack | string): string {
  if (typeof evidence === 'string') return evidence.toLowerCase();
  return stableJson({
    parentSpu: evidence.parentSpu,
    selectedVariant: evidence.selectedVariant,
    commonAcrossChildren: evidence.commonAcrossChildren,
    assortment: {
      strategy: evidence.assortment.strategy,
      sizes: evidence.assortment.sizes,
    },
    groundedNumericTokens: evidence.groundedNumericTokens,
  }).toLowerCase();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function validateAssortmentSizes(generatedText: string, evidence: ListingClaimPack | string): string[] {
  if (typeof evidence === 'string' || evidence.assortment.strategy !== 'single_size') return [];
  const allowed = new Set(evidence.assortment.sizes.map((size) => size.toUpperCase()));
  const mentioned = Array.from(generatedText.matchAll(/(?:^|[^A-Z])(SS|S|M|L|LL)\s*サイズ/gi))
    .map((match) => match[1]!.toUpperCase());
  for (const sequence of generatedText.matchAll(/(?:SS|S|M|L|LL)(?:\s*[\/・、]\s*(?:SS|S|M|L|LL))+/gi)) {
    mentioned.push(...(sequence[0].match(/SS|LL|S|M|L/gi) ?? []).map((size) => size.toUpperCase()));
  }
  return uniqueStrings(mentioned)
    .filter((size) => !allowed.has(size))
    .map((size) => `Generated copy claims size outside the verified SPU assortment: ${size}`);
}

export function validateProposal(
  proposal: CopyProposal,
  sourceTitle: string | null,
  sourceDescription: string | null,
  verifiedEvidence: ListingClaimPack | string = '',
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
  const isExplicitNoOp = proposal.title === null && proposal.description === null;

  if (typeof verifiedEvidence !== 'string') {
    if (!proposal.claimSelection) {
      errors.push('proposal must include deterministic claim selection');
    } else {
      const rendered = materializeClaimSelection(
        proposal.claimSelection, verifiedEvidence, proposal.confidence, proposal.rationale,
      );
      errors.push(...rendered.errors);
      if (rendered.proposal.title !== proposal.title || rendered.proposal.description !== proposal.description) {
        errors.push('proposal copy does not match deterministic claim rendering');
      }
      if (stableJson(rendered.proposal.claimAttributions) !== stableJson(proposal.claimAttributions)) {
        errors.push('proposal claim attributions do not match deterministic claim rendering');
      }
    }
  }

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

  if (!isExplicitNoOp && !titleBlank && !descBlank && !hasMaterialChange) {
    errors.push('proposal makes no material change to title or description');
  }

  const trustedFacts = evidenceText(verifiedEvidence);
  const generatedText = [proposal.title ?? '', proposal.description ?? ''].join('\n').toLowerCase();

  errors.push(...validateAssortmentSizes(generatedText, verifiedEvidence));

  for (const token of extractNumericTokens(generatedText)) {
    if (!trustedFacts.includes(token.toLowerCase())) {
      errors.push(`Generated copy includes unsourced numeric fact: ${token}`);
    }
  }

  for (const claim of PROHIBITED_CLAIMS) {
    if (generatedText.includes(claim)) {
      errors.push(`Generated copy includes prohibited claim: ${claim}`);
    }
  }

  for (const claim of HARD_FACT_EVIDENCE_TERMS) {
    if (generatedText.includes(claim) && !trustedFacts.includes(claim)) {
      errors.push(`Generated copy includes hard fact without trusted-fact evidence: ${claim}`);
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
  const titleClaimIds = Array.isArray(obj.title_claim_ids)
    ? obj.title_claim_ids.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : null;
  const descriptionClaimIds = Array.isArray(obj.description_claim_ids)
    ? obj.description_claim_ids.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : null;
  const confidence = typeof obj.confidence === 'number' ? obj.confidence : null;
  const rationale = typeof obj.rationale === 'string' && obj.rationale.trim() ? obj.rationale.trim() : '';

  if (confidence === null || confidence < 0 || confidence > 1) {
    return { proposal: null, errors: ['confidence must be a number between 0 and 1'] };
  }
  if (!rationale) {
    return { proposal: null, errors: ['rationale must be a non-empty string'] };
  }

  return {
    proposal: {
      title, description, confidence, rationale,
      ...(titleClaimIds !== null && descriptionClaimIds !== null ? {
        claimSelection: { titleClaimIds, descriptionClaimIds },
      } : {}),
    },
    errors: [],
  };
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

export async function callDeepSeek(
  prompt: string,
  model: string,
  apiKey: string,
  baseUrl = process.env['DEEPSEEK_BASE_URL'] ?? 'https://api.deepseek.com',
  timeoutMs = Number(process.env['LISTING_DEEPSEEK_TIMEOUT_MS'] ?? '120000'),
  fetchFn: typeof fetch = fetch,
): Promise<{ content: string; error?: string }> {
  const configuredMaxTokens = Number(process.env['LISTING_DEEPSEEK_MAX_TOKENS'] ?? '1800');
  const maxTokens = Number.isFinite(configuredMaxTokens)
    ? Math.min(Math.max(configuredMaxTokens, 900), 4000)
    : 1800;
  if (!apiKey) return { content: '', error: 'DEEPSEEK_API_KEY is required' };
  const effectiveTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs >= 1000
    ? Math.min(timeoutMs, 300000)
    : 120000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), effectiveTimeoutMs);
  try {
    const response = await fetchFn(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: maxTokens,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { content: '', error: `DeepSeek ${response.status}: ${(await response.text()).slice(0, 500)}` };
    }
    const body = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    if (body.error?.message) return { content: '', error: `DeepSeek error: ${body.error.message}` };
    return { content: body.choices?.[0]?.message?.content ?? '' };
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
): Promise<{ proposal: CopyProposal | null; validationStatus: CopyProposalResult['validationStatus']; validationErrors: string[]; repairAttempts: number; prompt: string; inputHash: string; outputHash: string; benchmarkEvaluation: CopyProposalResult['benchmarkEvaluation'] }> {
  const { prompt, inputHash } = proposalInputIdentity(listing, config);

  let validationErrors: string[] = [];
  let repairAttempts = 0;

  for (let attempt = 0; attempt <= 1; attempt++) {
    repairAttempts = attempt;
    const attemptPrompt = attempt === 0 ? prompt : buildCopyImprovementPrompt(listing, validationErrors);
    const result = await ollamaCall(attemptPrompt, config.model);

    if (result.error) {
      const outputHash = hash(result.error);
      return { proposal: null, validationStatus: 'failed', validationErrors: [result.error], repairAttempts: attempt, prompt: attemptPrompt, inputHash, outputHash, benchmarkEvaluation: null };
    }

    const parsed = parseProposalFromLLM(result.content);
    if (!parsed.proposal) {
      validationErrors = parsed.errors;
      if (attempt < 1) continue;
      const outputHash = hash(result.content);
      return { proposal: null, validationStatus: 'invalid', validationErrors, repairAttempts: attempt, prompt: attemptPrompt, inputHash, outputHash, benchmarkEvaluation: null };
    }

    validationErrors = [];
    let proposal = parsed.proposal;
    if (listing.verified_claim_pack && proposal.claimSelection) {
      const rendered = materializeClaimSelection(
        proposal.claimSelection,
        listing.verified_claim_pack,
        proposal.confidence,
        proposal.rationale,
      );
      proposal = rendered.proposal;
      validationErrors.push(...rendered.errors);
    }
    validationErrors.push(...validateProposal(
      proposal,
      listing.title,
      listing.description,
      listing.verified_claim_pack ?? '',
    ));
    const benchmark = listing.benchmark;
    const benchmarkEvaluation = benchmark
      ? evaluateAgainstBenchmark(listing, proposal, benchmark)
      : null;
    const isExplicitNoOp = proposal.title === null && proposal.description === null;
    if (benchmark && benchmarkEvaluation && !isExplicitNoOp) {
      if (benchmarkEvaluation.scoreDelta <= 0) {
        validationErrors.push('proposal does not improve the fixed benchmark score');
      }
      validationErrors.push(...benchmarkEvaluation.regressions);
      const copiedText = findBenchmarkCopyOverlap(proposal, benchmark);
      if (copiedText) validationErrors.push('proposal appears to copy distinctive benchmark wording');
    }
    if (validationErrors.length === 0) {
      const outputHash = hash(proposal);
      const status = attempt > 0 ? 'repaired' : 'valid';
      return { proposal, validationStatus: status, validationErrors: [], repairAttempts: attempt, prompt: attemptPrompt, inputHash, outputHash, benchmarkEvaluation };
    }

    if (attempt < 1) continue;
    const outputHash = hash(proposal);
    return { proposal, validationStatus: 'invalid', validationErrors, repairAttempts: attempt, prompt: attemptPrompt, inputHash, outputHash, benchmarkEvaluation };
  }

  const outputHash = hash('unreachable');
  return { proposal: null, validationStatus: 'failed', validationErrors: ['exhausted repair attempts'], repairAttempts: 1, prompt, inputHash, outputHash, benchmarkEvaluation: null };
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
