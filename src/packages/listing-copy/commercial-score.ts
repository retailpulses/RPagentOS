export interface CommercialFactor {
  id: string;
  terms: string[];
}

export interface CategoryCommercialProfile {
  decisionFactors: CommercialFactor[];
  titleTerms: CommercialFactor[];
  differentiators: CommercialFactor[];
  preferredTitleLength: { min: number; max: number };
  preferredDescriptionLength: { min: number; max: number };
  productTypeTerms: string[];
}

export interface CommercialQualityEvaluation {
  total: number;
  decisionCompleteness: number;
  titleSearchQuality: number;
  differentiation: number;
  readability: number;
  matchedDecisionFactors: string[];
  matchedTitleTerms: string[];
  matchedDifferentiators: string[];
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

function matchedFactors(text: string, factors: CommercialFactor[]): string[] {
  const normalized = normalize(text);
  return factors
    .filter((factor) => factor.terms.some((term) => normalized.includes(normalize(term))))
    .map((factor) => factor.id);
}

function weightedCoverage(matched: number, total: number, weight: number): number {
  if (total === 0) return 0;
  return Math.round((matched / total) * weight);
}

function countOccurrences(text: string, term: string): number {
  const normalizedText = normalize(text);
  const normalizedTerm = normalize(term);
  if (!normalizedTerm) return 0;
  let count = 0;
  let cursor = 0;
  while ((cursor = normalizedText.indexOf(normalizedTerm, cursor)) >= 0) {
    count++;
    cursor += normalizedTerm.length;
  }
  return count;
}

export function evaluateCommercialQuality(
  copy: { title: string; description: string },
  profile: CategoryCommercialProfile,
): CommercialQualityEvaluation {
  const combined = `${copy.title}\n${copy.description}`;
  const decisionMatches = matchedFactors(combined, profile.decisionFactors);
  const titleMatches = matchedFactors(copy.title, profile.titleTerms);
  const differentiatorMatches = matchedFactors(combined, profile.differentiators);

  const decisionCompleteness = weightedCoverage(
    decisionMatches.length, profile.decisionFactors.length, 40,
  );
  const titleCoverage = weightedCoverage(titleMatches.length, profile.titleTerms.length, 20);
  const normalizedTitle = normalize(copy.title);
  const productTypeFrontLoaded = profile.productTypeTerms.some((term) => {
    const index = normalizedTitle.indexOf(normalize(term));
    return index >= 0 && index <= 8;
  });
  const titleLength = [...copy.title].length;
  const titleLengthFit = titleLength >= profile.preferredTitleLength.min &&
    titleLength <= profile.preferredTitleLength.max;
  const titleSearchQuality = titleCoverage + (productTypeFrontLoaded ? 3 : 0) + (titleLengthFit ? 2 : 0);

  const differentiation = weightedCoverage(
    differentiatorMatches.length, profile.differentiators.length, 20,
  );

  const descriptionLength = [...copy.description].length;
  const descriptionLengthFit = descriptionLength >= profile.preferredDescriptionLength.min &&
    descriptionLength <= profile.preferredDescriptionLength.max;
  const hasUsefulStructure = /【[^】]+】/.test(copy.description) ||
    copy.description.split(/[。\n]/).filter((part) => part.trim()).length >= 5;
  const hasScanBreaks = copy.description.includes('\n') || /[・●■]/.test(copy.description);
  const excessiveProductTypeRepetition = profile.productTypeTerms.some(
    (term) => countOccurrences(combined, term) > 4,
  );
  const readability = (descriptionLengthFit ? 5 : 0) +
    (hasUsefulStructure ? 4 : 0) +
    (hasScanBreaks ? 3 : 0) +
    (excessiveProductTypeRepetition ? 0 : 3);

  return {
    total: decisionCompleteness + titleSearchQuality + differentiation + readability,
    decisionCompleteness,
    titleSearchQuality,
    differentiation,
    readability,
    matchedDecisionFactors: decisionMatches,
    matchedTitleTerms: titleMatches,
    matchedDifferentiators: differentiatorMatches,
  };
}
