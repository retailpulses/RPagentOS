import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

import { supabase } from '../lib/supabase.js';
import {
  applyContentUpdate,
  callDeepSeek,
  idempotencyKey,
  parseProposalFromLLM,
  validateProposal,
} from '../packages/listing-copy/improve-copy.js';
import {
  deterministicallyRepairGenericProposal,
  repairIssuesFromErrors,
} from '../packages/listing-copy/generic-repair.js';
import {
  buildGenericCopyProfile,
  evaluateGenericCommercialQuality,
  genericEvidenceValidationText,
  validateHardClaimAttributions,
  type GenericCopyProfile,
} from '../packages/listing-copy/generic-profile.js';
import {
  composeStructuredEnrichmentDescription,
  evaluatePreserveFirstEnrichment,
} from '../packages/listing-copy/preserve-first-enrich.js';
import { calculateCopyOpportunity } from '../packages/listing-copy/opportunity-score.js';
import { buildListingCopyDiff } from '../packages/listing-copy/wecom-report.js';
import {
  classifyListingCopyPreflight,
  operatorReviewReasons,
  repairInstructions,
  type OperatorReviewReason,
} from '../packages/listing-copy/loop-disposition.js';

interface CanaryListing {
  id: string;
  title: string;
  description: string;
  categoryId: string | null;
  categoryName: string | null;
  shopCode: string;
  productSpuId: string;
  productSpu: Record<string, unknown>;
  variants: Array<Record<string, unknown>>;
  contentRevision: number;
  opportunityScore: number;
  opportunityReasons: string[];
  evidenceFactCount: number;
}

interface AuditedClaim {
  text: string;
  supported: boolean;
  evidence_ids: string[];
  reason: string;
}

function isSoftBenefitOnly(value: string): boolean {
  const normalized = value.normalize('NFKC').replace(/\s+/g, '');
  return ['安心', 'スムーズ', '便利', '整理しやすい', '軽量', '大容量', '組立簡単', '簡単組立', '快適']
    .some((term) => normalized === term || normalized === `${term}です`);
}

function copyContainsClaim(copy: string, claim: string): boolean {
  const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[\s　:：,，、。・()（）【】「」]/g, '');
  const needle = normalize(claim);
  if (needle.length >= 2 && normalize(copy).includes(needle)) return true;
  const tokens = claim.normalize('NFKC').split(/[\s　:：,，、。・()（）【】「」]+/)
    .map(normalize).filter((token) => token.length >= 2);
  return tokens.length > 0 && tokens.every((token) => normalize(copy).includes(token));
}

let llmRequestCount = 0;
const DATABASE_REQUEST_TIMEOUT_MS = 30_000;
const LIVE_PROMPT_VERSION = 'generic-v3-live';

function databaseAbortSignal(): AbortSignal {
  return AbortSignal.timeout(DATABASE_REQUEST_TIMEOUT_MS);
}

function arg(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function numericArg(name: string, fallback: number, max: number): number {
  const parsed = Number(arg(name, String(fallback)));
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function plainText(value: string, limit = 2400): string {
  return value.replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/\n{3,}/g, '\n\n').trim().slice(0, limit);
}

function jsonObject(text: string): Record<string, unknown> {
  const normalized = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  const value = JSON.parse(normalized) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('model response is not a JSON object');
  return value as Record<string, unknown>;
}

async function callJsonDeepSeek(prompt: string, apiKey: string, model: string): Promise<Record<string, unknown>> {
  let lastError = 'invalid JSON';
  for (let attempt = 0; attempt < 2; attempt++) {
    llmRequestCount++;
    const effectivePrompt = attempt === 0 ? prompt : [
      prompt,
      '',
      'REPAIR: Your previous response was not parseable as one complete JSON object.',
      `Parser error: ${lastError}`,
      'Return a shorter, complete JSON object in the exact requested shape. No markdown.',
    ].join('\n');
    const response = await callDeepSeek(effectivePrompt, model, apiKey);
    if (response.error) { lastError = response.error; continue; }
    try { return jsonObject(response.content); } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(lastError);
}

async function fetchLowQualityListings(
  limit: number,
  minimumOpportunityScore: number,
  cooldownDays: number,
): Promise<{
  listings: CanaryListing[]; requests: number; rowsRead: number;
}> {
  const cooldownSince = new Date(Date.now() - cooldownDays * 86_400_000).toISOString();
  const [listingResult, recentReviewResult] = await Promise.all([
    supabase.from('platform_listings')
    .select('id,title,description,category_id,category_name,shop_code,content_revision,content_origin,updated_at')
    .eq('platform', 'rakuten')
    .in('lifecycle_stage', ['draft', 'enhanced'])
    .eq('content_origin', 'giga_generated')
    .order('updated_at', { ascending: false })
      .limit(100)
      .abortSignal(databaseAbortSignal()),
    supabase.from('listing_qwen_reviews')
      .select('structured_output')
      .eq('prompt_profile', 'rakuten_preserve_first_structured_enrich')
      .gte('created_at', cooldownSince)
      .limit(1000)
      .abortSignal(databaseAbortSignal()),
  ]);
  if (listingResult.error) throw new Error(`Fetch listings: ${listingResult.error.message}`);
  if (recentReviewResult.error) throw new Error(`Fetch recent live copy audits: ${recentReviewResult.error.message}`);
  const recentlyReviewed = new Set((recentReviewResult.data ?? []).flatMap((row) => {
    const output = row.structured_output;
    return output && typeof output === 'object' && !Array.isArray(output) &&
      typeof (output as Record<string, unknown>).listing_id === 'string'
      ? [String((output as Record<string, unknown>).listing_id)] : [];
  }));
  const rows = (listingResult.data ?? []).filter((row) =>
    row.title && row.description && !recentlyReviewed.has(row.id),
  );
  const linksResult = await supabase.from('product_platform_links')
    .select('listing_id,product_spu_id,variant_id,confidence')
    .in('listing_id', rows.map((row) => row.id))
    .not('product_spu_id', 'is', null)
    .order('confidence', { ascending: false })
    .abortSignal(databaseAbortSignal());
  if (linksResult.error) throw new Error(`Fetch links: ${linksResult.error.message}`);
  const spuByListing = new Map<string, string>();
  const variantIdsByListing = new Map<string, Set<string>>();
  for (const link of linksResult.data ?? []) {
    if (!spuByListing.has(link.listing_id) && typeof link.product_spu_id === 'string') {
      spuByListing.set(link.listing_id, link.product_spu_id);
    }
    if (typeof link.variant_id === 'string') {
      const current = variantIdsByListing.get(link.listing_id) ?? new Set<string>();
      current.add(link.variant_id);
      variantIdsByListing.set(link.listing_id, current);
    }
  }
  const linkedRows = rows.filter((row) => spuByListing.has(row.id));
  const candidateSpuIds = [...new Set(linkedRows.map((row) => spuByListing.get(row.id)!))];
  const [spuResult, variantResult, heroResult] = await Promise.all([
    supabase.from('product_spus').select('id,spu_code,title,category').in('id', candidateSpuIds)
      .abortSignal(databaseAbortSignal()),
    supabase.from('product_variants')
      .select('id,product_spu_id,item_code,raw_payload')
      .in('product_spu_id', candidateSpuIds)
      .limit(2500)
      .abortSignal(databaseAbortSignal()),
    supabase.from('merchandising_focus_items')
      .select('product_spu_id')
      .in('product_spu_id', candidateSpuIds)
      .eq('focus_type', 'hero')
      .eq('status', 'active')
      .abortSignal(databaseAbortSignal()),
  ]);
  if (spuResult.error) throw new Error(`Fetch SPUs: ${spuResult.error.message}`);
  if (variantResult.error) throw new Error(`Fetch variants: ${variantResult.error.message}`);
  if (heroResult.error) throw new Error(`Fetch hero flags: ${heroResult.error.message}`);
  const spus = new Map((spuResult.data ?? []).map((row) => [row.id, row as Record<string, unknown>]));
  const heroSpuIds = new Set((heroResult.data ?? []).map((row) => String(row.product_spu_id)));
  const variants = new Map<string, Array<Record<string, unknown>>>();
  for (const row of variantResult.data ?? []) {
    const key = String(row.product_spu_id);
    variants.set(key, [...(variants.get(key) ?? []), row as Record<string, unknown>]);
  }
  const candidates: CanaryListing[] = [];
  for (const row of linkedRows) {
    const productSpuId = spuByListing.get(row.id)!;
    if (heroSpuIds.has(productSpuId)) continue;
    const productSpu = spus.get(productSpuId);
    const allChildren = variants.get(productSpuId) ?? [];
    const linkedIds = variantIdsByListing.get(row.id);
    const linkedChildren = linkedIds?.size
      ? allChildren.filter((child) => linkedIds.has(String(child.id))) : [];
    const children = linkedChildren.length > 0 ? linkedChildren : allChildren;
    if (!productSpu || children.length === 0) continue;
    const profile = buildGenericCopyProfile({
      categoryId: row.category_id, categoryName: row.category_name,
      productSpu, spuVariants: children,
    });
    const beforeScore = evaluateGenericCommercialQuality({
      title: row.title!, description: row.description!,
    }, profile);
    const opportunity = calculateCopyOpportunity({
      title: row.title!, description: row.description!, commercialScore: beforeScore.total,
    });
    if (opportunity.score < minimumOpportunityScore) continue;
    candidates.push({
      id: row.id, title: row.title!, description: row.description!,
      categoryId: row.category_id, categoryName: row.category_name,
      shopCode: row.shop_code, productSpuId, productSpu, variants: children,
      contentRevision: typeof row.content_revision === 'number' ? row.content_revision : 1,
      opportunityScore: opportunity.score,
      opportunityReasons: opportunity.reasons,
      evidenceFactCount: profile.evidenceFacts.length,
    });
  }
  const selected = candidates
    .sort((a, b) => b.opportunityScore - a.opportunityScore || a.id.localeCompare(b.id))
    .slice(0, limit);
  return {
    listings: selected, requests: 6,
    rowsRead: rows.length + (linksResult.data?.length ?? 0) +
      (spuResult.data?.length ?? 0) + (variantResult.data?.length ?? 0) +
      (heroResult.data?.length ?? 0) + (recentReviewResult.data?.length ?? 0),
  };
}

function generationPrompt(
  listing: CanaryListing,
  profile: GenericCopyProfile,
  retryInstructions: string[] = [],
): string {
  const prompt = [
    'You are a senior Japanese Rakuten ecommerce copywriter.',
    'Use a preserve-first structured enrichment strategy. Do not rewrite or summarize the current title or description.',
    'Write only new Japanese content that is missing from the current description, organized under the five required standard headings.',
    'Do not repeat information already present. Prefer concrete product facts and benefits grounded in the supplied evidence.',
    'Commercial quality comes first. Generic non-quantified benefits such as 安心, スムーズ, 便利, 軽量, 大容量 are allowed.',
    'Every objective fact, number, material, color, component, mechanism, certification, compatibility, eligibility, warranty, included item, or named performance claim must be supported by one or more evidence IDs.',
    'Do not infer a child color or option for parent-level copy. Do not invent hard facts.',
    'Use each heading exactly once and in this order: 【商品概要】, 【特徴・ベネフィット】, 【商品仕様】, 【使用シーン・おすすめ】, 【お手入れ・注意事項】.',
    'Category-specific subheadings belong inside the appropriate standard section. Do not create 【追加情報】 or duplicate 商品仕様/商品スペック sections.',
    'Keep the new content focused and scannable. Do not output HTML.',
    'Return ONLY JSON with title set to null, description containing the five-section enrichment content, confidence, rationale, and hard_claims.',
    'hard_claims must enumerate every objective factual claim as {text,evidence_ids}. Do not include purely generic benefits as hard claims.',
    `Current title: ${listing.title}`,
    `Current description: ${plainText(listing.description, 5000)}`,
    `Generic profile: ${JSON.stringify({
      version: profile.profileVersion, categoryId: profile.categoryId,
      categoryName: profile.categoryName, productIdentity: profile.productIdentity,
    })}`,
    `First-party evidence: ${JSON.stringify(profile.evidenceFacts)}`,
    'Required JSON shape: {"title":null,"description":"【商品概要】...\\n【特徴・ベネフィット】...\\n【商品仕様】...\\n【使用シーン・おすすめ】...\\n【お手入れ・注意事項】...","confidence":0.0,"rationale":"...","hard_claims":[{"text":"...","evidence_ids":["..."]}]}',
  ];
  if (retryInstructions.length > 0) prompt.push(
    '',
    'REPAIR ATTEMPT: The previous proposal failed deterministic automatic-update gates.',
    ...retryInstructions.map((instruction) => `- ${instruction}`),
    'Return a corrected proposal, not an explanation.',
  );
  return prompt.join('\n');
}

function auditPrompt(copy: { title: string; description: string }, profile: GenericCopyProfile): string {
  return [
    'Act as a strict objective-claim auditor for Japanese ecommerce copy.',
    'Extract every objective hard claim: facts, numbers, materials, colors, components, mechanisms, certifications, compatibility, eligibility, warranty, included items, or named technical performance.',
    'Do not treat generic non-quantified benefits such as 安心, スムーズ, 便利, 軽量, 大容量, 整理しやすい as hard claims unless they add a specific objective fact or performance assertion.',
    'For each hard claim, decide whether the supplied first-party evidence directly supports it and cite exact evidence IDs.',
    'Return ONLY JSON: {"claims":[{"text":"...","supported":true,"evidence_ids":["..."],"reason":"..."}]}.',
    `Copy: ${JSON.stringify(copy)}`,
    `Evidence: ${JSON.stringify(profile.evidenceFacts)}`,
  ].join('\n');
}

function exactRepairFeedback(result: Record<string, unknown>): string[] {
  const feedback: string[] = [];
  const safetyErrors = Array.isArray(result.safetyErrors)
    ? result.safetyErrors.filter((error): error is string => typeof error === 'string').slice(0, 8) : [];
  if (safetyErrors.length > 0) feedback.push(`Exact validation errors: ${JSON.stringify(safetyErrors)}`);
  const enrichment = result.enrichmentEvaluation && typeof result.enrichmentEvaluation === 'object' &&
    !Array.isArray(result.enrichmentEvaluation)
    ? result.enrichmentEvaluation as Record<string, unknown> : null;
  const conflicts = Array.isArray(enrichment?.specificationConflicts)
    ? enrichment.specificationConflicts.slice(0, 8) : [];
  if (conflicts.length > 0) feedback.push(`Exact specification conflicts: ${JSON.stringify(conflicts)}`);
  return feedback;
}

async function runOne(
  listing: CanaryListing,
  apiKey: string,
  model: string,
  retryInstructions: string[] = [],
): Promise<Record<string, unknown>> {
  const profile = buildGenericCopyProfile({
    categoryId: listing.categoryId,
    categoryName: listing.categoryName || (typeof listing.productSpu.category === 'string' ? listing.productSpu.category : null),
    productSpu: listing.productSpu, spuVariants: listing.variants,
  });
  const raw = await callJsonDeepSeek(generationPrompt(listing, profile, retryInstructions), apiKey, model);
  const parsed = parseProposalFromLLM(JSON.stringify(raw));
  if (!parsed.proposal?.description) throw new Error(parsed.errors.join('; ') || 'missing enrichment block');
  const enrichmentProposal = { ...parsed.proposal, title: null };
  const declaredClaims = Array.isArray(raw.hard_claims) ? raw.hard_claims.flatMap((claim) => {
    if (!claim || typeof claim !== 'object') return [];
    const item = claim as Record<string, unknown>;
    return typeof item.text === 'string' && Array.isArray(item.evidence_ids)
      ? [{ text: item.text, evidenceIds: item.evidence_ids.filter((id): id is string => typeof id === 'string') }]
      : [];
  }) : [];
  const initialDeclaredErrors = validateHardClaimAttributions(declaredClaims, profile);
  const initialDeterministicErrors = validateProposal(
    enrichmentProposal, listing.title, listing.description,
    genericEvidenceValidationText(profile),
  );
  const auditJson = await callJsonDeepSeek(auditPrompt({
    title: '', description: enrichmentProposal.description ?? '',
  }, profile), apiKey, model);
  const claims = Array.isArray(auditJson.claims)
    ? auditJson.claims.filter((claim): claim is AuditedClaim => Boolean(claim && typeof claim === 'object'))
    : [];
  const unsupportedClaims = claims.filter((claim) => claim.supported !== true && !isSoftBenefitOnly(claim.text));
  const initialAuditAttributionErrors = validateHardClaimAttributions(
    claims.filter((claim) => claim.supported === true).map((claim) => ({
      text: String(claim.text ?? ''),
      evidenceIds: Array.isArray(claim.evidence_ids) ? claim.evidence_ids : [],
    })),
    profile,
  );
  const initialSafetyErrors = [
    ...initialDeclaredErrors, ...initialDeterministicErrors, ...initialAuditAttributionErrors,
    ...unsupportedClaims.map((claim) => `unsupported hard claim: ${claim.text}`),
  ];
  const repair = deterministicallyRepairGenericProposal(
    enrichmentProposal,
    repairIssuesFromErrors(initialSafetyErrors),
  );
  const repairedText = repair.proposal.description ?? '';
  const remainingDeclaredClaims = declaredClaims.filter((claim) => copyContainsClaim(repairedText, claim.text));
  const remainingSupportedAuditClaims = claims.filter((claim) =>
    claim.supported === true && copyContainsClaim(repairedText, String(claim.text ?? '')),
  );
  const finalSafetyErrors = [
    ...validateHardClaimAttributions(remainingDeclaredClaims, profile),
    ...validateHardClaimAttributions(remainingSupportedAuditClaims.map((claim) => ({
      text: String(claim.text ?? ''),
      evidenceIds: Array.isArray(claim.evidence_ids) ? claim.evidence_ids : [],
    })), profile),
    ...validateProposal(
      repair.proposal, listing.title, listing.description,
      genericEvidenceValidationText(profile),
    ),
    ...repair.unresolvedIssues.map((issue) => `unresolved deterministic repair: ${issue.needle}`),
  ];
  const beforeScore = evaluateGenericCommercialQuality({ title: listing.title, description: listing.description }, profile);
  const structured = composeStructuredEnrichmentDescription(
    listing.description,
    repair.proposal.description ?? '',
  );
  const finalProposal = {
    ...repair.proposal,
    title: listing.title,
    description: structured.description,
    rationale: `${repair.proposal.rationale} Preserve-first structured enrichment retained source blocks and merged new content into five standard sections.`,
  };
  const proposedScore = evaluateGenericCommercialQuality({
    title: finalProposal.title, description: finalProposal.description,
  }, profile);
  const commercialDelta = proposedScore.total - beforeScore.total;
  const safetyPassed = finalSafetyErrors.length === 0;
  const enrichmentEvaluation = evaluatePreserveFirstEnrichment({
    sourceDescription: listing.description,
    proposedDescription: finalProposal.description,
    specificationConflicts: structured.specificationConflicts,
    beforeScore,
    proposedScore,
  });
  return {
    listingId: listing.id, shopCode: listing.shopCode, productSpuId: listing.productSpuId,
    spuCode: listing.productSpu.spu_code ?? null,
    categoryId: listing.categoryId, categoryName: profile.categoryName,
    profileVersion: profile.profileVersion, evidenceFactCount: profile.evidenceFacts.length,
    strategy: enrichmentEvaluation.strategy,
    opportunityScore: listing.opportunityScore,
    opportunityReasons: listing.opportunityReasons,
    before: { title: listing.title, description: listing.description },
    originalProposal: parsed.proposal,
    enrichmentBlock: repair.proposal.description,
    proposed: finalProposal,
    declaredHardClaims: declaredClaims, auditedHardClaims: claims,
    deterministicRepair: {
      changed: repair.changed,
      removedTitleParts: repair.removedTitleParts,
      removedDescriptionParts: repair.removedDescriptionParts,
    },
    initialSafetyErrors, safetyPassed,
    safetyErrors: finalSafetyErrors, beforeCommercialScore: beforeScore,
    proposedCommercialScore: proposedScore,
    commercialDelta, enrichmentEvaluation,
    eligible: safetyPassed && commercialDelta > 0 && enrichmentEvaluation.hasSubstantiveCommercialGain,
  };
}

function contentHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function structuredAuditOutput(
  listing: CanaryListing,
  result: Record<string, unknown>,
  outcome: string,
  contentRevision: number | null = null,
): Record<string, unknown> {
  return {
    kind: 'listing_copy_live', listing_id: listing.id,
    opportunity_score: listing.opportunityScore,
    opportunity_reasons: listing.opportunityReasons,
    preflight_disposition: result.preflightDisposition ?? null,
    disposition: result.disposition ?? 'needs_operator_review',
    operator_review_reasons: result.operatorReviewReasons ?? [],
    llm_invoked: result.llmInvoked === true,
    model_attempts: result.modelAttempts ?? 0,
    model_repair_attempts: result.modelRepairAttempts ?? 0,
    safety_passed: result.safetyPassed === true,
    commercial_delta: result.commercialDelta ?? null,
    eligible: result.autoEligible === true,
    apply_outcome: outcome,
    applied_content_revision: contentRevision,
    enrichment_evaluation: result.enrichmentEvaluation ?? null,
  };
}

async function persistLiveAudit(
  listing: CanaryListing,
  result: Record<string, unknown>,
  model: string,
  autoEligible: boolean,
): Promise<string> {
  const proposed = result.proposed && typeof result.proposed === 'object'
    ? result.proposed as Record<string, unknown> : null;
  const confidence = typeof proposed?.confidence === 'number' ? proposed.confidence : null;
  const validationErrors = Array.isArray(result.safetyErrors) ? result.safetyErrors : [];
  const llmInvoked = result.llmInvoked === true;
  const modelRepairAttempts = typeof result.modelRepairAttempts === 'number' ? result.modelRepairAttempts : 0;
  const { data, error } = await supabase.from('listing_qwen_reviews').insert({
    llm_provider: llmInvoked ? 'deepseek' : 'deterministic',
    llm_runtime: llmInvoked ? 'deepseek_api' : 'preflight_rules',
    llm_model: llmInvoked ? model : 'listing-copy-preflight-v1',
    prompt_profile: 'rakuten_preserve_first_structured_enrich',
    prompt_version: LIVE_PROMPT_VERSION,
    input_hash: contentHash({ listingId: listing.id, revision: listing.contentRevision, title: listing.title, description: listing.description }),
    output_hash: contentHash(proposed),
    source_snapshot_hash: contentHash({ title: listing.title, description: listing.description }),
    source_snapshot_version: listing.contentRevision,
    risk_level: autoEligible ? 'low' : 'medium',
    confidence,
    summary: typeof proposed?.rationale === 'string' ? proposed.rationale
      : result.disposition === 'needs_operator_review'
        ? 'Low-quality listing needs optional operator review'
        : 'DeepSeek live copy loop evaluation',
    issues: validationErrors,
    recommendations: [],
    suggested_title: typeof proposed?.title === 'string' ? proposed.title : null,
    suggested_description: typeof proposed?.description === 'string' ? proposed.description : null,
    structured_output: structuredAuditOutput(
      listing, result, typeof result.applyOutcome === 'string' ? result.applyOutcome : 'pending',
    ),
    raw_request: { evidence_fact_count: result.evidenceFactCount ?? listing.evidenceFactCount, llm_invoked: llmInvoked },
    raw_response: {},
    validation_status: autoEligible ? (modelRepairAttempts > 0 ? 'repaired' : 'valid')
      : typeof result.error === 'string' && result.error ? 'failed' : 'invalid',
    validation_errors: validationErrors,
    repair_attempts: modelRepairAttempts + (result.deterministicRepair && typeof result.deterministicRepair === 'object' &&
      (result.deterministicRepair as Record<string, unknown>).changed === true ? 1 : 0),
    error_message: typeof result.error === 'string' ? result.error : null,
  }).select('id').abortSignal(databaseAbortSignal()).single();
  if (error) throw new Error(`Persist live copy audit: ${error.message}`);
  return String(data.id);
}

async function recordApplyOutcome(
  reviewId: string,
  listing: CanaryListing,
  result: Record<string, unknown>,
  outcome: string,
  contentRevision: number | null,
): Promise<void> {
  const { error } = await supabase.from('listing_qwen_reviews').update({
    structured_output: structuredAuditOutput(listing, result, outcome, contentRevision),
  }).eq('id', reviewId).abortSignal(databaseAbortSignal());
  if (error) throw new Error(`Update live copy audit: ${error.message}`);
}

async function main(): Promise<void> {
  const limit = numericArg('limit', 1, 5);
  const mode = arg('mode', process.env.COPY_APPLY_MODE ?? 'dry_run');
  if (mode !== 'dry_run' && mode !== 'auto') throw new Error('mode must be dry_run or auto');
  const model = arg('model', 'deepseek-chat');
  const apiKey = process.env.DEEPSEEK_API_KEY ?? '';
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY is required');
  const minimumOpportunityScore = Number(arg(
    'min-opportunity-score', process.env.COPY_LIVE_MIN_OPPORTUNITY_SCORE ?? '35',
  ));
  const confidenceThreshold = Number(process.env.COPY_LIVE_CONFIDENCE_THRESHOLD ?? '0.90');
  const minimumCommercialDelta = Number(process.env.COPY_LIVE_MIN_COMMERCIAL_DELTA ?? '10');
  const cooldownDays = Number(process.env.COPY_LIVE_COOLDOWN_DAYS ?? '7');
  if (!Number.isFinite(minimumOpportunityScore) || minimumOpportunityScore < 0 || minimumOpportunityScore > 100) {
    throw new Error('COPY_LIVE_MIN_OPPORTUNITY_SCORE must be between 0 and 100');
  }
  if (!Number.isFinite(confidenceThreshold) || confidenceThreshold < 0 || confidenceThreshold > 1) {
    throw new Error('COPY_LIVE_CONFIDENCE_THRESHOLD must be between 0 and 1');
  }
  if (!Number.isFinite(minimumCommercialDelta) || minimumCommercialDelta < 0 || minimumCommercialDelta > 100) {
    throw new Error('COPY_LIVE_MIN_COMMERCIAL_DELTA must be between 0 and 100');
  }
  if (!Number.isInteger(cooldownDays) || cooldownDays < 1 || cooldownDays > 90) {
    throw new Error('COPY_LIVE_COOLDOWN_DAYS must be an integer between 1 and 90');
  }
  const autoShops = new Set((process.env.COPY_IMPROVEMENT_AUTO_SHOPS ?? '')
    .split(',').map((value) => value.trim()).filter(Boolean));
  const internalApiUrl = process.env.INTERNAL_CATALOG_API_URL ?? 'https://rpagentos.pages.dev/api/internal/catalog';
  const internalApiToken = process.env.INTERNAL_CATALOG_API_TOKEN ?? '';
  if (mode === 'auto') {
    if (process.env.COPY_IMPROVEMENT_ENABLED !== 'true') {
      throw new Error('COPY_IMPROVEMENT_ENABLED must be exactly "true" for auto mode');
    }
    if (autoShops.size === 0) throw new Error('COPY_IMPROVEMENT_AUTO_SHOPS is required for auto mode');
    if (!internalApiToken) throw new Error('INTERNAL_CATALOG_API_TOKEN is required for auto mode');
  }
  const startedAt = Date.now();
  const selection = await fetchLowQualityListings(limit, minimumOpportunityScore, cooldownDays);
  const results: Array<Record<string, unknown>> = [];
  let databaseRequests = selection.requests;
  let applied = 0;
  let stale = 0;
  let applyFailed = 0;
  let pipelineFailed = 0;
  for (const listing of selection.listings) {
    let result: Record<string, unknown>;
    const shopEnabled = mode === 'dry_run' || autoShops.has(listing.shopCode);
    const preflight = classifyListingCopyPreflight({
      opportunityReasons: listing.opportunityReasons,
      evidenceFactCount: listing.evidenceFactCount,
      shopEnabled,
    });
    if (preflight.disposition === 'needs_operator_review') {
      result = {
        listingId: listing.id, shopCode: listing.shopCode, productSpuId: listing.productSpuId,
        spuCode: listing.productSpu.spu_code ?? null,
        opportunityScore: listing.opportunityScore,
        opportunityReasons: listing.opportunityReasons,
        evidenceFactCount: listing.evidenceFactCount,
        preflightDisposition: preflight.disposition,
        disposition: 'needs_operator_review',
        operatorReviewReasons: preflight.reasons,
        llmInvoked: false, modelAttempts: 0, modelRepairAttempts: 0,
        safetyPassed: null, commercialDelta: null, autoEligible: false,
        applyOutcome: mode === 'auto' ? 'skipped_preflight' : 'dry_run',
      };
    } else {
      try {
        result = await runOne(listing, apiKey, model);
        let reviewReasons = operatorReviewReasons({
          result, opportunityReasons: listing.opportunityReasons,
          minimumCommercialDelta, confidenceThreshold, shopEnabled,
        });
        let modelAttempts = 1;
        let modelRepairAttempts = 0;
        const instructions = [...repairInstructions(reviewReasons), ...exactRepairFeedback(result)];
        if (reviewReasons.length > 0 && instructions.length > 0) {
          result = await runOne(listing, apiKey, model, instructions);
          modelAttempts++;
          modelRepairAttempts++;
          reviewReasons = operatorReviewReasons({
            result, opportunityReasons: listing.opportunityReasons,
            minimumCommercialDelta, confidenceThreshold, shopEnabled,
          });
        }
        result.preflightDisposition = 'auto_fixable';
        result.disposition = reviewReasons.length === 0 ? 'auto_fixable' : 'needs_operator_review';
        result.operatorReviewReasons = reviewReasons;
        result.llmInvoked = true;
        result.modelAttempts = modelAttempts;
        result.modelRepairAttempts = modelRepairAttempts;
        result.autoEligible = reviewReasons.length === 0;
        result.applyOutcome = mode === 'auto' ? 'skipped' : 'dry_run';
      } catch (error) {
        pipelineFailed++;
        result = {
          listingId: listing.id, shopCode: listing.shopCode, productSpuId: listing.productSpuId,
          spuCode: listing.productSpu.spu_code ?? null,
          opportunityScore: listing.opportunityScore,
          opportunityReasons: listing.opportunityReasons,
          evidenceFactCount: listing.evidenceFactCount,
          preflightDisposition: 'auto_fixable', disposition: 'needs_operator_review',
          operatorReviewReasons: ['pipeline_error'] satisfies OperatorReviewReason[],
          llmInvoked: true, modelAttempts: 1, modelRepairAttempts: 0,
          safetyPassed: false, commercialDelta: null, autoEligible: false,
          applyOutcome: mode === 'auto' ? 'pipeline_failed' : 'dry_run',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    let reviewId: string | null = null;
    try {
      const proposed = result.proposed && typeof result.proposed === 'object'
        ? result.proposed as Record<string, unknown> : null;
      if (mode === 'auto') {
        reviewId = await persistLiveAudit(listing, result, model, result.autoEligible === true);
        databaseRequests++;
        if (result.autoEligible === true && proposed) {
          const proposalHash = contentHash(proposed);
          const outcome = await applyContentUpdate({
            listingId: listing.id,
            title: typeof proposed.title === 'string' ? proposed.title : null,
            description: typeof proposed.description === 'string' ? proposed.description : null,
            expectedRevision: listing.contentRevision,
            idempotencyKey: idempotencyKey(listing.id, proposalHash),
            model,
            promptVersion: LIVE_PROMPT_VERSION,
          }, internalApiUrl, internalApiToken, fetch);
          databaseRequests++;
          result.applyOutcome = outcome.outcome;
          result.appliedContentRevision = outcome.contentRevision;
          if (outcome.outcome === 'updated' || outcome.outcome === 'replay') {
            applied++;
            result.disposition = 'auto_updated';
          } else if (outcome.outcome === 'stale_revision') {
            stale++;
            result.disposition = 'needs_operator_review';
            result.operatorReviewReasons = ['stale_revision'] satisfies OperatorReviewReason[];
          } else {
            applyFailed++;
            result.disposition = 'needs_operator_review';
            result.operatorReviewReasons = ['canonical_apply_failed'] satisfies OperatorReviewReason[];
          }
        }
        await recordApplyOutcome(
          reviewId, listing, result, String(result.applyOutcome),
          typeof result.appliedContentRevision === 'number' ? result.appliedContentRevision : null,
        );
        databaseRequests++;
      }
    } catch (error) {
      applyFailed++;
      result.disposition = 'needs_operator_review';
      result.operatorReviewReasons = ['canonical_apply_failed'] satisfies OperatorReviewReason[];
      result.applyOutcome = 'apply_failed';
      result.error = error instanceof Error ? error.message : String(error);
      if (reviewId) {
        try {
          await recordApplyOutcome(reviewId, listing, result, 'apply_failed', null);
          databaseRequests++;
        } catch {
          // The original failure remains in the run report when audit finalization also fails.
        }
      }
    }
    results.push(result);
  }
  const modelResults = results.filter((result) => result.llmInvoked === true);
  const passed = modelResults.filter((result) => result.safetyPassed === true);
  const compact = process.argv.includes('--compact');
  const outputResults = compact ? results.map((result) => {
    const before = result.before as { title?: string; description?: string } | undefined;
    const proposed = result.proposed as { title?: string; description?: string; rationale?: string; confidence?: number } | undefined;
    const audited = Array.isArray(result.auditedHardClaims) ? result.auditedHardClaims as AuditedClaim[] : [];
    return {
      listingId: result.listingId, shopCode: result.shopCode,
      productSpuId: result.productSpuId, spuCode: result.spuCode,
      categoryId: result.categoryId, categoryName: result.categoryName,
      opportunityScore: result.opportunityScore, opportunityReasons: result.opportunityReasons,
      evidenceFactCount: result.evidenceFactCount,
      preflightDisposition: result.preflightDisposition,
      disposition: result.disposition,
      operatorReviewReasons: result.operatorReviewReasons,
      llmInvoked: result.llmInvoked,
      modelAttempts: result.modelAttempts,
      modelRepairAttempts: result.modelRepairAttempts,
      before: { title: before?.title ?? null, descriptionExcerpt: plainText(before?.description ?? '', 500) },
      proposed: { title: proposed?.title ?? null, description: proposed?.description ?? null, rationale: proposed?.rationale ?? null },
      confidence: proposed?.confidence ?? null,
      safetyPassed: result.safetyPassed, safetyErrors: result.safetyErrors,
      eligible: result.eligible ?? false,
      autoEligible: result.autoEligible ?? false,
      applyOutcome: result.applyOutcome ?? null,
      deterministicRepair: result.deterministicRepair,
      error: result.error ?? null,
      unsupportedHardClaims: audited.filter((claim) => claim.supported !== true).map((claim) => claim.text),
      beforeCommercialScore: result.beforeCommercialScore,
      proposedCommercialScore: result.proposedCommercialScore,
      commercialDelta: result.commercialDelta,
      diff: before && proposed ? buildListingCopyDiff({
        beforeTitle: before.title ?? '', afterTitle: proposed.title ?? before.title ?? '',
        beforeDescription: before.description ?? '', afterDescription: proposed.description ?? before.description ?? '',
      }) : null,
    };
  }) : results;
  const report = JSON.stringify({
    kind: 'rakuten_copy_live_loop', mode, dryRun: mode === 'dry_run', marketplaceApplied: false,
    selector: 'copy_opportunity_score_v1', minimumOpportunityScore,
    minimumCommercialDelta, confidenceThreshold, cooldownDays,
    requested: limit, selected: selection.listings.length,
    provider: 'deepseek', model, databaseRequests,
    rowsRead: selection.rowsRead, llmRequests: llmRequestCount,
    lowQualityFound: selection.listings.length,
    sentToPipeline: modelResults.length,
    preflightAutoFixable: results.filter((result) => result.preflightDisposition === 'auto_fixable').length,
    needsOperatorReview: results.filter((result) => result.disposition === 'needs_operator_review').length,
    autoEligibilityRate: modelResults.length > 0
      ? results.filter((result) => result.autoEligible === true).length / modelResults.length : 0,
    autoUpdateRate: modelResults.length > 0 ? applied / modelResults.length : 0,
    operatorReviewReasonCounts: results.flatMap((result) => Array.isArray(result.operatorReviewReasons)
      ? result.operatorReviewReasons.filter((reason): reason is string => typeof reason === 'string') : [])
      .reduce<Record<string, number>>((counts, reason) => ({ ...counts, [reason]: (counts[reason] ?? 0) + 1 }), {}),
    modelRepairAttempts: results.reduce((sum, result) => sum +
      (typeof result.modelRepairAttempts === 'number' ? result.modelRepairAttempts : 0), 0),
    safetyPassed: passed.length, safetyFailed: modelResults.length - passed.length,
    commerciallyImproved: results.filter((result) => typeof result.commercialDelta === 'number' && result.commercialDelta > 0).length,
    eligible: results.filter((result) => result.eligible === true).length,
    autoEligible: results.filter((result) => result.autoEligible === true).length,
    canonicalApplied: applied, stale, applyFailed, pipelineFailed,
    operatorConfirmationRequired: 0,
    runtimeMs: Date.now() - startedAt, results: outputResults,
  }, null, 2);
  const outputFile = arg('output-file', '');
  if (outputFile) writeFileSync(outputFile, `${report}\n`, { encoding: 'utf8', mode: 0o600 });
  console.log(report);
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
