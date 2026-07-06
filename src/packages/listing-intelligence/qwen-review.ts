import { createHash } from 'crypto';
import { supabase } from '../../lib/supabase.js';

const DEFAULT_MODEL = process.env['LISTING_QWEN_MODEL'] ?? 'qwen3.5:9b';
const DEFAULT_OLLAMA_URL = process.env['OLLAMA_BASE_URL'] ?? 'http://127.0.0.1:11434';
const PROMPT_VERSION = 'v1';
const MAX_REPAIR_ATTEMPTS = 1;

type JsonRecord = Record<string, unknown>;

interface ListingWorkItemRow {
  id: string;
  workflow_type: string;
  issue_type: string | null;
  recommended_action: string | null;
  target_type: string;
  target_id: string;
  target_key: string;
  platform: string | null;
  shop_code: string | null;
  priority_score: number;
  issue_severity: string;
  is_hero: boolean;
  human_input_level: string;
  status: string;
  source_context: JsonRecord;
  source_snapshot_hash: string | null;
  source_snapshot_version: number;
  classification_reasons: JsonRecord[];
  deterministic_findings: JsonRecord[];
}

interface OllamaGenerateResponse {
  response?: string;
  message?: { role?: string; content?: string };
  model?: string;
  done?: boolean;
  error?: string;
  total_duration?: number;
}

export interface QwenReviewOutput {
  overall_score: number;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  summary: string;
  issues: Array<{
    type: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    evidence: string;
    operator_note: string;
  }>;
  recommendations: Array<{
    action_type: 'no_action' | 'rewrite' | 'image_fix' | 'price_check' | 'mapping_fix' | 'manual_review' | 'create_task';
    priority: 'low' | 'medium' | 'high' | 'critical';
    reason: string;
  }>;
  suggested_title?: string;
  suggested_description?: string;
  suggested_image_plan: JsonRecord[];
  human_review_required: boolean;
  confidence: number;
}

export interface QwenReviewResult {
  review_id: string;
  result_id: string;
  run_id: string;
  work_item_id: string;
  validation_status: 'valid' | 'repaired' | 'invalid' | 'failed';
  repair_attempts: number;
  summary: string | null;
  risk_level: string;
  confidence: number | null;
  prompt_profile: string;
  llm_model: string;
  skipped_existing: boolean;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as JsonRecord;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
}

function hash(value: unknown): string {
  return createHash('sha256').update(typeof value === 'string' ? value : stableJson(value)).digest('hex');
}

function compact(value: unknown, maxLength = 9000): string {
  const text = stableJson(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...[truncated]` : text;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function promptProfileFor(item: ListingWorkItemRow): string {
  if (item.platform === 'amazon') return 'amazon_mapping_audit_v1';
  return 'rakuten_listing_audit_v1';
}

function assertEligible(item: ListingWorkItemRow): void {
  if (item.platform !== 'rakuten' && item.platform !== 'amazon') {
    throw new Error(`Qwen review is only enabled for Rakuten/Amazon MVP-1 work items. Got platform=${item.platform ?? '-'}.`);
  }
  if (item.issue_type === 'missing_mapping' || item.recommended_action === 'create_mapping_task') {
    throw new Error('Unresolved mapping work items must be fixed deterministically before Qwen review.');
  }
  const findingText = stableJson([item.classification_reasons, item.deterministic_findings]).toLowerCase();
  if (findingText.includes('missing_mapping') || findingText.includes('create_mapping_task')) {
    throw new Error('This work item includes unresolved mapping findings; fix mapping before Qwen review.');
  }
  if (item.workflow_type !== 'audit_existing_listing') {
    throw new Error(`Qwen MVP-1 reviews audit_existing_listing items only. Got workflow_type=${item.workflow_type}.`);
  }
}

async function fetchWorkItem(workItemId: string): Promise<ListingWorkItemRow> {
  const { data, error } = await supabase
    .from('listing_work_items')
    .select('*')
    .eq('id', workItemId)
    .single();

  if (error) throw new Error(`Fetch work item: ${error.message}`);
  return data as unknown as ListingWorkItemRow;
}

async function findReusableReview(item: ListingWorkItemRow, model: string): Promise<QwenReviewResult | null> {
  if (!item.source_snapshot_hash) return null;

  const { data, error } = await supabase
    .from('listing_qwen_reviews')
    .select('id,result_id,run_id,work_item_id,validation_status,repair_attempts,summary,risk_level,confidence,prompt_profile,llm_model')
    .eq('work_item_id', item.id)
    .eq('source_snapshot_hash', item.source_snapshot_hash)
    .eq('source_snapshot_version', item.source_snapshot_version)
    .eq('llm_model', model)
    .in('validation_status', ['valid', 'repaired'])
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw new Error(`Find reusable review: ${error.message}`);
  const row = data?.[0] as {
    id?: string;
    result_id?: string;
    run_id?: string;
    validation_status?: string;
    repair_attempts?: number;
    summary?: string | null;
    risk_level?: string;
    confidence?: number | null;
    prompt_profile?: string;
    llm_model?: string;
  } | undefined;
  if (!row?.id || !row.result_id || !row.run_id) return null;

  return {
    review_id: row.id,
    result_id: row.result_id,
    run_id: row.run_id,
    work_item_id: item.id,
    validation_status: row.validation_status as QwenReviewResult['validation_status'],
    repair_attempts: Number(row.repair_attempts ?? 0),
    summary: row.summary ?? null,
    risk_level: String(row.risk_level ?? 'medium'),
    confidence: typeof row.confidence === 'number' ? row.confidence : null,
    prompt_profile: String(row.prompt_profile ?? promptProfileFor(item)),
    llm_model: String(row.llm_model ?? model),
    skipped_existing: true,
  };
}

function buildSystemRules(item: ListingWorkItemRow): string {
  const platformRules = item.platform === 'amazon'
    ? [
      'Focus on Amazon offer/listing readiness and mapping consistency.',
      'This Amazon export may have limited content fields; do not invent title, description, category, price, or stock facts.',
      'Use mapping_fix only when the source context itself supports a mapping concern.',
    ]
    : [
      'Focus on Rakuten listing content/readiness.',
      'Review title, catch copy, description signals, search tags, image coverage, variant clarity, and forbidden claims.',
      'Suggested Rakuten copy must stay grounded in the provided source context.',
    ];

  return [
    'You are the local Qwen reviewer inside RPagentOS Listing Intelligence MVP-1.',
    'Return one strict JSON object only. No markdown, no explanations outside JSON.',
    'Do not create facts. Do not change price, stock, size, material, color, dimensions, warranty, or availability unless already present in the source context.',
    'Every issue evidence must cite what is visible or missing in the source context.',
    'If the item is already acceptable, use no_action and a high score.',
    ...platformRules,
  ].join('\n');
}

function buildOutputContract(): JsonRecord {
  return {
    overall_score: 'number 0-100',
    risk_level: 'low | medium | high | critical',
    summary: 'short operator-facing summary',
    issues: [{ type: 'string', severity: 'low|medium|high|critical', evidence: 'string', operator_note: 'string' }],
    recommendations: [{ action_type: 'no_action|rewrite|image_fix|price_check|mapping_fix|manual_review|create_task', priority: 'low|medium|high|critical', reason: 'string' }],
    suggested_title: 'optional string; omit if not grounded',
    suggested_description: 'optional string; omit if not grounded',
    suggested_image_plan: [{ image_type: 'string', purpose: 'string', required_source_fact: 'string' }],
    human_review_required: 'boolean',
    confidence: 'number 0-1',
  };
}

function buildPrompt(item: ListingWorkItemRow, repairErrors?: string[]): string {
  const request: JsonRecord = {
    task: item.platform === 'amazon' ? 'amazon_mapping_audit' : 'rakuten_listing_audit',
    required_json_keys: Object.keys(buildOutputContract()),
    allowed_risk_level: ['low', 'medium', 'high', 'critical'],
    allowed_action_type: ['no_action', 'rewrite', 'image_fix', 'price_check', 'mapping_fix', 'manual_review', 'create_task'],
    allowed_priority: ['low', 'medium', 'high', 'critical'],
    work_item: {
      id: item.id,
      workflow_type: item.workflow_type,
      issue_type: item.issue_type,
      recommended_action: item.recommended_action,
      platform: item.platform,
      shop_code: item.shop_code,
      issue_severity: item.issue_severity,
      source_snapshot_hash: item.source_snapshot_hash,
      source_snapshot_version: item.source_snapshot_version,
      source_context: item.source_context,
      deterministic_findings: item.deterministic_findings.slice(0, 5),
    },
  };

  if (repairErrors && repairErrors.length > 0) {
    request['repair_instruction'] = {
      errors: repairErrors,
      instruction: 'Return corrected JSON that satisfies the output contract and source-fact rules.',
    };
  }

  return `/no_think\n${buildSystemRules(item)}\n\nReturn JSON with this exact shape:\n{"overall_score":75,"risk_level":"medium","summary":"...","issues":[{"type":"...","severity":"medium","evidence":"...","operator_note":"..."}],"recommendations":[{"action_type":"manual_review","priority":"medium","reason":"..."}],"suggested_title":"...","suggested_description":"...","suggested_image_plan":[],"human_review_required":true,"confidence":0.75}\n\nREQUEST_JSON:\n${compact(request, 3500)}`;
}

async function callOllama(prompt: string, model: string): Promise<OllamaGenerateResponse> {
  const url = `${DEFAULT_OLLAMA_URL.replace(/\/$/, '')}/api/chat`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env['LISTING_QWEN_TIMEOUT_MS'] ?? 240000));

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        think: false,
        options: { temperature: 0.1, num_predict: 900, num_ctx: 4096 },
      }),
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`Ollama ${response.status}: ${await response.text()}`);
    const body = await response.json() as OllamaGenerateResponse;
    return {
      ...body,
      response: body.response ?? body.message?.content,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseJsonResponse(text: string): JsonRecord {
  const trimmed = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  try {
    return asRecord(JSON.parse(trimmed));
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return asRecord(JSON.parse(trimmed.slice(start, end + 1)));
    throw new Error('Qwen response was not valid JSON.');
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function validateReviewShape(raw: JsonRecord): { output: QwenReviewOutput | null; errors: string[] } {
  const errors: string[] = [];
  const allowedRisk = ['low', 'medium', 'high', 'critical'];
  const allowedActions = ['no_action', 'rewrite', 'image_fix', 'price_check', 'mapping_fix', 'manual_review', 'create_task'];
  const allowedPriority = ['low', 'medium', 'high', 'critical'];

  const overallScore = asNumber(raw['overall_score']);
  if (overallScore === null || overallScore < 0 || overallScore > 100) errors.push('overall_score must be a number between 0 and 100.');

  const riskLevel = asString(raw['risk_level']);
  if (!riskLevel || !allowedRisk.includes(riskLevel)) errors.push('risk_level must be low, medium, high, or critical.');

  const summary = asString(raw['summary']);
  if (!summary) errors.push('summary is required.');

  const issuesRaw = Array.isArray(raw['issues']) ? raw['issues'] : null;
  if (!issuesRaw) errors.push('issues must be an array.');
  const issues = (issuesRaw ?? []).map((issue, index) => {
    const row = asRecord(issue);
    const type = asString(row['type']);
    const severity = asString(row['severity']);
    const evidence = asString(row['evidence']);
    const operatorNote = asString(row['operator_note']);
    if (!type) errors.push(`issues[${index}].type is required.`);
    if (!severity || !allowedPriority.includes(severity)) errors.push(`issues[${index}].severity is invalid.`);
    if (!evidence) errors.push(`issues[${index}].evidence is required.`);
    if (!operatorNote) errors.push(`issues[${index}].operator_note is required.`);
    return { type: type ?? 'manual_review', severity: (severity ?? 'medium') as QwenReviewOutput['issues'][number]['severity'], evidence: evidence ?? '', operator_note: operatorNote ?? '' };
  });

  const recommendationsRaw = Array.isArray(raw['recommendations']) ? raw['recommendations'] : null;
  if (!recommendationsRaw) errors.push('recommendations must be an array.');
  const recommendations = (recommendationsRaw ?? []).map((recommendation, index) => {
    const row = asRecord(recommendation);
    const actionType = asString(row['action_type']);
    const priority = asString(row['priority']);
    const reason = asString(row['reason']);
    if (!actionType || !allowedActions.includes(actionType)) errors.push(`recommendations[${index}].action_type is invalid.`);
    if (!priority || !allowedPriority.includes(priority)) errors.push(`recommendations[${index}].priority is invalid.`);
    if (!reason) errors.push(`recommendations[${index}].reason is required.`);
    return { action_type: (actionType ?? 'manual_review') as QwenReviewOutput['recommendations'][number]['action_type'], priority: (priority ?? 'medium') as QwenReviewOutput['recommendations'][number]['priority'], reason: reason ?? '' };
  });

  const suggestedTitle = asString(raw['suggested_title']) ?? undefined;
  const suggestedDescription = asString(raw['suggested_description']) ?? undefined;
  const suggestedImagePlan = Array.isArray(raw['suggested_image_plan']) ? raw['suggested_image_plan'].map(asRecord) : [];
  const humanReviewRequired = asBoolean(raw['human_review_required']);
  if (humanReviewRequired === null) errors.push('human_review_required must be boolean.');
  const confidence = asNumber(raw['confidence']);
  if (confidence === null || confidence < 0 || confidence > 1) errors.push('confidence must be a number between 0 and 1.');

  if (errors.length > 0 || overallScore === null || !riskLevel || !summary || humanReviewRequired === null || confidence === null) {
    return { output: null, errors };
  }

  return {
    output: {
      overall_score: overallScore,
      risk_level: riskLevel as QwenReviewOutput['risk_level'],
      summary,
      issues,
      recommendations,
      suggested_title: suggestedTitle,
      suggested_description: suggestedDescription,
      suggested_image_plan: suggestedImagePlan,
      human_review_required: humanReviewRequired,
      confidence,
    },
    errors,
  };
}

function extractSourcedTokens(text: string): string[] {
  const matches = text.match(/\d+(?:\.\d+)?\s?(?:cm|mm|kg|g|l|ml|L|W|V|kW|個|枚|台|色|年|ヶ月|畳|キロ|センチ|リットル)/g);
  return Array.from(new Set(matches ?? []));
}

function validateSourceFacts(output: QwenReviewOutput, item: ListingWorkItemRow): string[] {
  const sourceText = stableJson(item.source_context).toLowerCase();
  const errors: string[] = [];
  const generatedText = [output.suggested_title, output.suggested_description].filter(Boolean).join('\n').toLowerCase();

  for (const token of extractSourcedTokens(generatedText)) {
    if (!sourceText.includes(token.toLowerCase())) {
      errors.push(`Generated copy includes unsourced numeric fact: ${token}`);
    }
  }

  const unsupportedClaims = ['no.1', '最安', '絶対', '完全防水', '医療', '治療', '永久保証'];
  for (const claim of unsupportedClaims) {
    if (generatedText.includes(claim) && !sourceText.includes(claim)) {
      errors.push(`Generated copy includes unsupported claim: ${claim}`);
    }
  }

  return errors;
}

async function createRun(item: ListingWorkItemRow, model: string, promptProfile: string): Promise<string> {
  const { data, error } = await supabase
    .from('listing_intelligence_runs')
    .insert({
      run_type: 'qwen_review',
      status: 'running',
      work_item_id: item.id,
      platform: item.platform,
      shop_code: item.shop_code,
      source_snapshot_hash: item.source_snapshot_hash,
      source_snapshot_version: item.source_snapshot_version,
      metadata: { llm_runtime: 'ollama', llm_model: model, prompt_profile: promptProfile },
    })
    .select('id')
    .single();

  if (error) throw new Error(`Create run: ${error.message}`);
  return String((data as { id: string }).id);
}

async function finishRun(runId: string, status: 'completed' | 'failed', errorMessage?: string): Promise<void> {
  const { error } = await supabase
    .from('listing_intelligence_runs')
    .update({ status, error_message: errorMessage ?? null, completed_at: new Date().toISOString() })
    .eq('id', runId);

  if (error) throw new Error(`Finish run: ${error.message}`);
}

async function persistReview(params: {
  item: ListingWorkItemRow;
  runId: string;
  model: string;
  promptProfile: string;
  inputHash: string;
  rawRequest: JsonRecord;
  rawResponse: OllamaGenerateResponse | null;
  structuredOutput: JsonRecord;
  output: QwenReviewOutput | null;
  validationStatus: 'valid' | 'repaired' | 'invalid' | 'failed';
  validationErrors: string[];
  repairAttempts: number;
  errorMessage?: string;
}): Promise<QwenReviewResult> {
  const resultPayload = params.output ?? params.structuredOutput;
  const { data: resultRow, error: resultError } = await supabase
    .from('listing_intelligence_results')
    .insert({
      run_id: params.runId,
      work_item_id: params.item.id,
      result_type: 'qwen_review',
      status: params.validationStatus === 'valid' || params.validationStatus === 'repaired' ? 'ready' : params.validationStatus,
      source_snapshot_hash: params.item.source_snapshot_hash,
      source_snapshot_version: params.item.source_snapshot_version,
      payload: resultPayload,
      validation_status: params.validationStatus,
      validation_errors: params.validationErrors,
    })
    .select('id')
    .single();

  if (resultError) throw new Error(`Create result: ${resultError.message}`);
  const resultId = String((resultRow as { id: string }).id);

  const outputHash = params.output ? hash(params.output) : hash(params.structuredOutput);
  const { data: reviewRow, error: reviewError } = await supabase
    .from('listing_qwen_reviews')
    .insert({
      run_id: params.runId,
      result_id: resultId,
      work_item_id: params.item.id,
      llm_model: params.model,
      prompt_profile: params.promptProfile,
      prompt_version: PROMPT_VERSION,
      input_hash: params.inputHash,
      output_hash: outputHash,
      source_snapshot_hash: params.item.source_snapshot_hash,
      source_snapshot_version: params.item.source_snapshot_version,
      risk_level: params.output?.risk_level ?? 'medium',
      confidence: params.output?.confidence ?? null,
      summary: params.output?.summary ?? null,
      issues: params.output?.issues ?? [],
      recommendations: params.output?.recommendations ?? [],
      suggested_title: params.output?.suggested_title ?? null,
      suggested_description: params.output?.suggested_description ?? null,
      suggested_image_plan: params.output?.suggested_image_plan ?? [],
      structured_output: params.structuredOutput,
      raw_request: params.rawRequest,
      raw_response: params.rawResponse ?? {},
      validation_status: params.validationStatus,
      validation_errors: params.validationErrors,
      repair_attempts: params.repairAttempts,
      error_message: params.errorMessage ?? null,
    })
    .select('id')
    .single();

  if (reviewError) throw new Error(`Create review: ${reviewError.message}`);

  await supabase
    .from('listing_work_items')
    .update({ latest_result_id: resultId, updated_at: new Date().toISOString() })
    .eq('id', params.item.id);

  return {
    review_id: String((reviewRow as { id: string }).id),
    result_id: resultId,
    run_id: params.runId,
    work_item_id: params.item.id,
    validation_status: params.validationStatus,
    repair_attempts: params.repairAttempts,
    summary: params.output?.summary ?? null,
    risk_level: params.output?.risk_level ?? 'medium',
    confidence: params.output?.confidence ?? null,
    prompt_profile: params.promptProfile,
    llm_model: params.model,
    skipped_existing: false,
  };
}

export async function runQwenReviewForWorkItem(workItemId: string, options: { force?: boolean; model?: string } = {}): Promise<QwenReviewResult> {
  const model = options.model ?? DEFAULT_MODEL;
  const item = await fetchWorkItem(workItemId);
  assertEligible(item);

  if (!options.force) {
    const reusable = await findReusableReview(item, model);
    if (reusable) return reusable;
  }

  const promptProfile = promptProfileFor(item);
  const runId = await createRun(item, model, promptProfile);
  let lastRawResponse: OllamaGenerateResponse | null = null;
  let structuredOutput: JsonRecord = {};
  let validationErrors: string[] = [];
  let output: QwenReviewOutput | null = null;
  let repairAttempts = 0;
  const prompt = buildPrompt(item);
  const inputHash = hash({ promptProfile, promptVersion: PROMPT_VERSION, model, itemHash: item.source_snapshot_hash, prompt });

  try {
    for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt += 1) {
      repairAttempts = attempt;
      const attemptPrompt = attempt === 0 ? prompt : buildPrompt(item, validationErrors);
      lastRawResponse = await callOllama(attemptPrompt, model);
      if (lastRawResponse.error) throw new Error(lastRawResponse.error);
      structuredOutput = parseJsonResponse(lastRawResponse.response ?? '{}');

      const shape = validateReviewShape(structuredOutput);
      output = shape.output;
      validationErrors = [...shape.errors];
      if (output) validationErrors.push(...validateSourceFacts(output, item));

      if (output && validationErrors.length === 0) {
        const status = attempt > 0 ? 'repaired' : 'valid';
        const result = await persistReview({
          item,
          runId,
          model,
          promptProfile,
          inputHash,
          rawRequest: { prompt_profile: promptProfile, prompt_version: PROMPT_VERSION, model, prompt: attemptPrompt },
          rawResponse: lastRawResponse,
          structuredOutput,
          output,
          validationStatus: status,
          validationErrors,
          repairAttempts: attempt,
        });
        await finishRun(runId, 'completed');
        return result;
      }
    }

    const result = await persistReview({
      item,
      runId,
      model,
      promptProfile,
      inputHash,
      rawRequest: { prompt_profile: promptProfile, prompt_version: PROMPT_VERSION, model, prompt },
      rawResponse: lastRawResponse,
      structuredOutput,
      output,
      validationStatus: 'invalid',
      validationErrors,
      repairAttempts,
      errorMessage: validationErrors.join('; '),
    });
    await finishRun(runId, 'completed');
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Qwen review failed';
    await persistReview({
      item,
      runId,
      model,
      promptProfile,
      inputHash,
      rawRequest: { prompt_profile: promptProfile, prompt_version: PROMPT_VERSION, model, prompt },
      rawResponse: lastRawResponse,
      structuredOutput,
      output,
      validationStatus: 'failed',
      validationErrors: [message],
      repairAttempts,
      errorMessage: message,
    });
    await finishRun(runId, 'failed', message);
    throw error;
  }
}
