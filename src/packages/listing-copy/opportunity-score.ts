import { visibleListingText } from './preserve-first-enrich.js';

export interface CopyOpportunityScore {
  score: number;
  reasons: string[];
}

export function calculateCopyOpportunity(input: {
  title: string;
  description: string;
  commercialScore: number;
}): CopyOpportunityScore {
  const titleLength = [...input.title.trim()].length;
  const visibleDescription = visibleListingText(input.description);
  const descriptionLength = [...visibleDescription].length;
  const reasons: string[] = [];
  let score = Math.max(0, Math.min(100, 100 - input.commercialScore));

  if (titleLength < 28) {
    score += 10;
    reasons.push('short_title');
  }
  if (descriptionLength < 120) {
    score += 10;
    reasons.push('short_description');
  }
  if (!/【[^】]+】/.test(visibleDescription) && visibleDescription.split('\n').filter(Boolean).length < 3) {
    score += 8;
    reasons.push('weak_structure');
  }
  if (descriptionLength > 0 && new Set(visibleDescription.split(/[。\n]/).map((part) => part.trim()).filter(Boolean)).size <= 2) {
    score += 5;
    reasons.push('thin_information');
  }

  if (reasons.length === 0) reasons.push('low_commercial_coverage');
  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
}
