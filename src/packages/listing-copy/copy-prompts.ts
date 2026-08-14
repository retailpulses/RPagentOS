import { type ListingRow } from './types.js';
import { buildRenderableCopyClaims } from './claim-attribution.js';

export const PROMPT_PROFILE = 'rakuten_benchmarked_copy_improvement';
export const PROMPT_VERSION = 'v6';

export function buildCopyImprovementPrompt(
  listing: ListingRow,
  repairErrors?: string[],
): string {
  const sourceFacts: Record<string, unknown> = {
    platform: listing.platform,
    shop_code: listing.shop_code,
    current_title: listing.title ?? '(no title)',
    current_description: listing.description ?? '(no description)',
    verified_claim_pack: listing.verified_claim_pack ?? {
      unsupported_or_missing: ['No verified claim pack is available; do not add factual product claims.'],
    },
    available_renderable_claims: listing.verified_claim_pack
      ? buildRenderableCopyClaims(listing.verified_claim_pack)
      : [],
  };
  const benchmarkContext = listing.benchmark ? {
    benchmark_id: listing.benchmark.id,
    benchmark_version: listing.benchmark.version,
    category_id: listing.benchmark.categoryId,
    category_name: listing.benchmark.categoryName,
    source_kind: listing.benchmark.sourceKind,
    captured_at: listing.benchmark.capturedAt,
    title_terms_observed_across_the_set: listing.benchmark.titleTerms,
    buyer_decision_topics_observed_across_the_set: listing.benchmark.descriptionTopics,
    assortment_structure_observed_across_the_set: listing.benchmark.assortment,
  } : null;

  const instructions = [
    'You are a Rakuten listing copy improvement assistant for RPagentOS.',
    'Your task is to improve the Japanese title and description for a Rakuten product listing.',
    'The shopper goal is to decide accurately whether this product fits their needs and proceed toward purchase when it does.',
    'Traffic context is Rakuten category/search browsing; lead with clear product type and decision-relevant differentiators.',
    '',
    'RULES:',
    '- Return ONLY a single JSON object. No markdown, no explanations outside JSON.',
    '- Do not write title or description copy directly.',
    '- Select claim IDs for the title and description. RPagentOS renders the exact approved Japanese text deterministically.',
    '- Use only IDs from available_renderable_claims and only where titleText is non-null for title_claim_ids.',
    '- Order the IDs in the desired shopper-facing order.',
    '- VERIFIED CLAIM PACK is the only authority for factual product claims.',
    '- Attribute names with no value and sibling marketing names are not verified claim evidence.',
    '- Current title and description are copy to improve, not proof that their claims are true.',
    '- Do NOT create, preserve, or repeat a factual claim unless it appears explicitly in verified_claim_pack.',
    '- Parent-level copy may use only parentSpu facts. selectedVariant facts apply only to the selected item code.',
    '- commonAcrossChildren facts are safe for parent copy because every SPU child shares them.',
    '- unsupportedOrMissing names claims that are explicitly unavailable and must not be used.',
    '- assortment.childCount is an operational grouping count, not a consumer-facing color or option claim.',
    '- The deterministic renderer, not the model, controls factual wording. Do not infer benefits, capacity, quality, certifications, mechanisms, suitability, or ease of use.',
    '- A TSAロック label proves only that the product has a TSAロック; it does not prove how it works, where it is recognized, or travel/security benefits.',
    '- Omit color, material, dimensions, capacity, wheel/caster details, and lightness claims when they are not explicitly authorized.',
    '- BENCHMARK TARGET is structural market evidence only. It is never evidence that this product has a competitor feature.',
    '- Respect verified parent-child assortment facts. Never claim S/M/L availability unless those sizes exist in the verified SPU assortment.',
    '- If benchmark leaders combine multiple sizes but this SPU offers one size, use that only as listing-strategy evidence and clearly write for the verified size.',
    '- Use benchmark terms and decision topics only when supported by VERIFIED CLAIM PACK.',
    '- Do not copy sentences or distinctive phrasing from benchmark listings.',
    '- Preserve useful verified information; do not shorten copy merely to make it concise.',
    '- Explain the product type, verified differentiators, buyer-relevant benefits, specifications, fit/use context, and care/delivery/assembly details when verified and category-relevant.',
    '- Do NOT include prohibited claims: No.1, ナンバーワン, 最安, 絶対, 完全防水, 医療, 治療, 永久保証, or similar superlatives/medical claims.',
    '- If the current copy is already acceptable or cannot be improved safely, return empty arrays for both claim-ID fields.',
    '- Confidence (0-1) must reflect how grounded the suggestions are in the source facts.',
    '- If you cannot make a material improvement, return empty arrays to indicate no change.',
    '',
    'SOURCE LISTING:',
    JSON.stringify(sourceFacts, null, 2),
    '',
    'BENCHMARK TARGET:',
    benchmarkContext ? JSON.stringify(benchmarkContext, null, 2) : 'No fixed category benchmark is available. Improve conservatively using verified facts only.',
    '',
    'REQUIRED JSON SHAPE:',
    JSON.stringify({
      title_claim_ids: ['string — ordered IDs selected from available_renderable_claims'],
      description_claim_ids: ['string — ordered IDs selected from available_renderable_claims'],
      confidence: 'number 0-1 — confidence that suggestions are grounded and compliant',
      rationale: 'string — brief explanation of claim selection or why no change is safe',
    }),
  ];

  if (repairErrors && repairErrors.length > 0) {
    instructions.push(
      '',
      'REPAIR INSTRUCTIONS:',
      'Your previous output was rejected with these errors:',
      ...repairErrors.map((e) => `  - ${e}`),
      'Please return corrected JSON that fixes all the listed issues.',
    );
  }

  return instructions.join('\n');
}
