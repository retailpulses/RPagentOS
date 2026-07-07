// Deterministic score engine — Phase 2.
//
// Pure functions with no side effects. Computes six sub-scores from snapshot
// image health data and generated issues, then aggregates via marketplace-
// specific weights into a final_score.
//
// Phase 1 replaced: inline `technicalScore = loadedCount/totalCount * 100`.

import { getWeights, getThresholds, getImageRequirements } from './marketplace-config.js';
import { getIssueDefinition } from './issue-taxonomy.js';
import type { MarketplaceScoreWeights } from './marketplace-config.js';
import type { IssueType } from './issue-taxonomy.js';
import type {
  Marketplace,
  QualityIssue,
  ScoreCompleteness,
  ScoreEngineInput,
  ScoreEngineOutput,
  ScoreGrade,
  SnapshotImage,
} from './types.js';

// ─── Per-dimension scoring functions ────────────────────────────────────────

/**
 * Technical score: image health basics.
 * - Loaded ratio (how many images returned HTTP 2xx)
 * - HTTP status quality (are we getting proper 200s or degraded responses)
 * - Resolution adequacy
 */
function computeTechnicalScore(
  images: SnapshotImage[],
  marketplace: Marketplace,
): number {
  if (images.length === 0) return 0;

  const reqs = getImageRequirements(marketplace);
  let score = 100;

  // Loaded ratio penalty: each failed image costs proportionally
  const loadedCount = images.filter((img) => img.loaded).length;
  const loadRatio = loadedCount / images.length;
  score -= Math.round((1 - loadRatio) * 100);

  // Resolution penalty: each loaded image under min dimension costs
  for (const img of images) {
    if (!img.loaded) continue;
    if (img.width !== null && img.width < reqs.minDimension) {
      score -= Math.round((1 - img.width / reqs.minDimension) * 10);
    }
    if (img.height !== null && img.height < reqs.minDimension) {
      score -= Math.round((1 - img.height / reqs.minDimension) * 10);
    }
  }

  // HTTP status penalty: non-200 responses on loaded images
  for (const img of images) {
    if (img.http_status !== null && img.http_status !== 200) {
      score -= 5;
    }
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Image score: image quality, count adequacy, main image presence.
 */
function computeImageScore(
  images: SnapshotImage[],
  issues: QualityIssue[],
  marketplace: Marketplace,
): number {
  if (images.length === 0) return 0;

  const reqs = getImageRequirements(marketplace);
  let score = 100;

  // Image count: below recommended → penalty
  const loadedImages = images.filter((img) => img.loaded);
  if (loadedImages.length < reqs.recommendedImageCount) {
    const ratio = loadedImages.length / reqs.recommendedImageCount;
    score -= Math.round((1 - ratio) * 40);
  }

  // Main image presence
  const hasMainImage = images.some((img) => img.is_main_image && img.loaded);
  if (!hasMainImage) {
    score -= 35;
  }

  // Main image quality: is the main image high resolution?
  const mainImage = images.find((img) => img.is_main_image);
  if (mainImage && mainImage.loaded && mainImage.width !== null && mainImage.height !== null) {
    if (mainImage.width < reqs.minDimension || mainImage.height < reqs.minDimension) {
      score -= 20;
    }
  }

  // Issue penalties
  for (const issue of issues) {
    const def = getIssueDefinition(issue.type as IssueType);
    if (def.affectsScores.includes('image')) {
      score -= severityPenalty(issue.severity);
    }
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Content score: OCR text quality, keyword presence.
 */
function computeContentScore(
  images: SnapshotImage[],
  issues: QualityIssue[],
  title: string | null,
  description: string | null,
  _marketplace: Marketplace,
): number {
  let score = 100;

  // OCR coverage: what fraction of loaded images have OCR text?
  const loadedImages = images.filter((img) => img.loaded);
  if (loadedImages.length > 0) {
    const ocrImages = loadedImages.filter((img) => img.ocr_text && img.ocr_text.length > 0);
    const ocrRatio = ocrImages.length / loadedImages.length;
    if (ocrRatio < 0.5) {
      score -= Math.round((0.5 - ocrRatio) * 40);
    }
  }

  // Title quality
  if (!title || title.length === 0) {
    score -= 30;
  } else if (title.length < 18) {
    score -= 15;
  }

  // Description quality
  if (!description || description.length === 0) {
    score -= 25;
  } else if (description.length < 80) {
    score -= 10;
  }

  // Issue penalties
  for (const issue of issues) {
    const def = getIssueDefinition(issue.type as IssueType);
    if (def.affectsScores.includes('content')) {
      score -= severityPenalty(issue.severity);
    }
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Compliance score: marketplace rule violations.
 */
function computeComplianceScore(
  issues: QualityIssue[],
  _marketplace: Marketplace,
): number {
  let score = 100;

  // Only compliance-category issues affect this score
  for (const issue of issues) {
    const def = getIssueDefinition(issue.type as IssueType);
    if (def.affectsScores.includes('compliance')) {
      score -= severityPenalty(issue.severity);
    }
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Conversion score: optimization for purchase conversion.
 */
function computeConversionScore(
  images: SnapshotImage[],
  issues: QualityIssue[],
  _marketplace: Marketplace,
): number {
  let score = 100;

  // Image type diversity bonus (inverse: penalize missing types)
  const hasLifestyle = issues.some((i) => i.type === 'no_lifestyle_image');
  const hasScaleRef = issues.some((i) => i.type === 'no_scale_reference');
  const hasCloseup = issues.some((i) => i.type === 'no_detail_closeup');

  if (hasLifestyle) score -= 15;
  if (hasScaleRef) score -= 10;
  if (hasCloseup) score -= 10;

  // Issue penalties
  for (const issue of issues) {
    const def = getIssueDefinition(issue.type as IssueType);
    if (def.affectsScores.includes('conversion')) {
      score -= severityPenalty(issue.severity);
    }
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Operational risk score: lower is riskier (higher risk).
 * Broken main image, price anomalies, status problems.
 */
function computeOperationalRiskScore(
  images: SnapshotImage[],
  issues: QualityIssue[],
  price: number | null,
  _marketplace: Marketplace,
): number {
  let score = 100;

  // Broken main image = high operational risk
  const mainBroken = images.some((img) => img.is_main_image && !img.loaded);
  if (mainBroken) score -= 40;

  // No images at all = extreme risk
  if (images.length === 0) score -= 30;

  // Price sanity: 300–500,000 JPY range
  if (price !== null && price !== undefined) {
    if (price < 300 || price > 500000) {
      score -= 30;
    }
  }

  // Issue penalties
  for (const issue of issues) {
    const def = getIssueDefinition(issue.type as IssueType);
    if (def.affectsScores.includes('operationalRisk')) {
      score -= severityPenalty(issue.severity);
    }
  }

  return Math.max(0, Math.min(100, score));
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function severityPenalty(severity: string): number {
  switch (severity) {
    case 'critical': return 25;
    case 'high': return 15;
    case 'medium': return 8;
    case 'low': return 3;
    default: return 5;
  }
}

function weightedSum(
  scores: Record<keyof MarketplaceScoreWeights, number>,
  weights: MarketplaceScoreWeights,
): number {
  return Math.round(
    scores.technical * weights.technical +
    scores.image * weights.image +
    scores.content * weights.content +
    scores.compliance * weights.compliance +
    scores.conversion * weights.conversion +
    scores.operationalRisk * weights.operationalRisk,
  );
}

// ─── Main entry point ───────────────────────────────────────────────────────

export type { ScoreGrade } from './types.js';

/**
 * Compute all six sub-scores and aggregate into a final_score using
 * marketplace-specific weights. Pure function — no I/O, no side effects.
 */
export function computeScores(input: ScoreEngineInput): ScoreEngineOutput {
  const weights = getWeights(input.marketplace);

  const technicalScore = computeTechnicalScore(input.snapshotImages, input.marketplace);
  const imageScore = computeImageScore(input.snapshotImages, input.issues, input.marketplace);
  const contentScore = computeContentScore(input.snapshotImages, input.issues, input.title, input.description, input.marketplace);
  const complianceScore = computeComplianceScore(input.issues, input.marketplace);
  const conversionScore = computeConversionScore(input.snapshotImages, input.issues, input.marketplace);
  const operationalRiskScore = computeOperationalRiskScore(input.snapshotImages, input.issues, input.price, input.marketplace);

  const subScores: Record<keyof MarketplaceScoreWeights, number> = {
    technical: technicalScore,
    image: imageScore,
    content: contentScore,
    compliance: complianceScore,
    conversion: conversionScore,
    operationalRisk: operationalRiskScore,
  };

  const finalScore = weightedSum(subScores, weights);

  const scoreCompleteness: ScoreCompleteness = {
    technical: true,
    ocr: input.ocrSucceeded,
    marketplace_rules: true, // Phase 2
    qwen_visual: false,      // Phase 4 (queued async Qwen per design spec)
    human_review: false,
  };

  return {
    technicalScore,
    imageScore,
    contentScore,
    complianceScore,
    conversionScore,
    operationalRiskScore,
    finalScore,
    scoreStatus: 'complete',
    scoreCompleteness,
    computedDimensions: Object.keys(weights),
  };
}

/**
 * Convert a numeric score (0–100) to a grade using marketplace thresholds.
 */
export function scoreToGrade(score: number, marketplace: Marketplace): ScoreGrade {
  const thresholds = getThresholds(marketplace);
  if (score < thresholds.critical) return 'critical';
  if (score < thresholds.high) return 'high';
  if (score < thresholds.medium) return 'medium';
  return 'low';
}

/**
 * Returns a human-readable label for a score grade.
 */
export function gradeLabel(grade: ScoreGrade): string {
  switch (grade) {
    case 'critical': return 'Critical — needs immediate attention';
    case 'high': return 'High — review required';
    case 'medium': return 'Medium — minor improvements needed';
    case 'low': return 'Good — no action required';
  }
}
