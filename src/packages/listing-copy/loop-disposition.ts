export type ListingCopyDisposition = 'auto_fixable' | 'auto_updated' | 'needs_operator_review';

export type OperatorReviewReason =
  | 'insufficient_product_evidence'
  | 'unsupported_opportunity_type'
  | 'shop_not_enabled'
  | 'pipeline_error'
  | 'stale_revision'
  | 'canonical_apply_failed'
  | 'safety_validation_failed'
  | 'source_not_preserved'
  | 'specification_conflict'
  | 'no_substantive_commercial_gain'
  | 'insufficient_commercial_gain'
  | 'confidence_below_threshold';

export const AUTO_FIXABLE_OPPORTUNITY_REASONS = new Set([
  'short_title',
  'short_description',
  'weak_structure',
  'thin_information',
  'low_commercial_coverage',
]);

export interface PreflightClassification {
  disposition: 'auto_fixable' | 'needs_operator_review';
  reasons: OperatorReviewReason[];
}

export function classifyListingCopyPreflight(input: {
  opportunityReasons: string[];
  evidenceFactCount: number;
  shopEnabled: boolean;
}): PreflightClassification {
  const reasons: OperatorReviewReason[] = [];
  if (input.evidenceFactCount < 3) reasons.push('insufficient_product_evidence');
  if (!input.opportunityReasons.some((reason) => AUTO_FIXABLE_OPPORTUNITY_REASONS.has(reason))) {
    reasons.push('unsupported_opportunity_type');
  }
  if (!input.shopEnabled) reasons.push('shop_not_enabled');
  return reasons.length === 0
    ? { disposition: 'auto_fixable', reasons: [] }
    : { disposition: 'needs_operator_review', reasons };
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function operatorReviewReasons(input: {
  result: Record<string, unknown>;
  opportunityReasons: string[];
  minimumCommercialDelta: number;
  confidenceThreshold: number;
  shopEnabled: boolean;
}): OperatorReviewReason[] {
  const reasons: OperatorReviewReason[] = [];
  const result = input.result;
  const proposed = objectValue(result.proposed);
  const enrichment = objectValue(result.enrichmentEvaluation);
  const confidence = typeof proposed?.confidence === 'number' ? proposed.confidence : 0;
  const commercialDelta = typeof result.commercialDelta === 'number' ? result.commercialDelta : null;

  if (typeof result.error === 'string' && result.error) reasons.push('pipeline_error');
  if (result.safetyPassed !== true) reasons.push('safety_validation_failed');
  if (enrichment?.sourcePreserved !== true) reasons.push('source_not_preserved');
  if (Array.isArray(enrichment?.specificationConflicts) && enrichment.specificationConflicts.length > 0) {
    reasons.push('specification_conflict');
  }
  if (enrichment?.hasSubstantiveCommercialGain !== true) reasons.push('no_substantive_commercial_gain');
  if (commercialDelta === null || commercialDelta < input.minimumCommercialDelta) {
    reasons.push('insufficient_commercial_gain');
  }
  if (confidence < input.confidenceThreshold) reasons.push('confidence_below_threshold');
  if (!input.opportunityReasons.some((reason) => AUTO_FIXABLE_OPPORTUNITY_REASONS.has(reason))) {
    reasons.push('unsupported_opportunity_type');
  }
  if (!input.shopEnabled) reasons.push('shop_not_enabled');
  return [...new Set(reasons)];
}

export function repairInstructions(reasons: OperatorReviewReason[]): string[] {
  const instructions: string[] = [];
  if (reasons.includes('safety_validation_failed') || reasons.includes('pipeline_error')) {
    instructions.push('Remove every claim that is not directly supported by the supplied evidence IDs.');
  }
  if (reasons.includes('source_not_preserved')) {
    instructions.push('Return additions only; do not paraphrase, replace, or omit any source content.');
  }
  if (reasons.includes('specification_conflict')) {
    instructions.push('Do not add a specification label already present in the source unless the value is exactly identical; omit uncertain specifications.');
  }
  if (reasons.includes('no_substantive_commercial_gain') || reasons.includes('insufficient_commercial_gain')) {
    instructions.push('Add missing decision factors and differentiators using only concrete supplied evidence; avoid repeating the current description.');
  }
  if (reasons.includes('confidence_below_threshold')) {
    instructions.push('Use fewer, stronger evidence-backed additions so confidence can be at least the required threshold.');
  }
  return instructions;
}
