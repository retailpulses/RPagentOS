import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyListingCopyPreflight,
  operatorReviewReasons,
  repairInstructions,
} from './loop-disposition.js';

test('treats low commercial coverage as auto-fixable before model invocation', () => {
  assert.deepEqual(classifyListingCopyPreflight({
    opportunityReasons: ['low_commercial_coverage'], evidenceFactCount: 8, shopEnabled: true,
  }), { disposition: 'auto_fixable', reasons: [] });
});

test('routes unsupported or evidence-thin listings to optional operator review', () => {
  assert.deepEqual(classifyListingCopyPreflight({
    opportunityReasons: ['image_quality'], evidenceFactCount: 2, shopEnabled: true,
  }), {
    disposition: 'needs_operator_review',
    reasons: ['insufficient_product_evidence', 'unsupported_opportunity_type'],
  });
});

test('explains every failed post-generation gate and produces retry guidance', () => {
  const reasons = operatorReviewReasons({
    opportunityReasons: ['low_commercial_coverage'], minimumCommercialDelta: 10,
    confidenceThreshold: 0.9, shopEnabled: true,
    result: {
      safetyPassed: true, commercialDelta: 8,
      proposed: { confidence: 0.85 },
      enrichmentEvaluation: {
        sourcePreserved: true,
        specificationConflicts: [{ label: '素材' }],
        hasSubstantiveCommercialGain: false,
      },
    },
  });
  assert.deepEqual(reasons, [
    'specification_conflict', 'no_substantive_commercial_gain',
    'insufficient_commercial_gain', 'confidence_below_threshold',
  ]);
  assert.ok(repairInstructions(reasons).some((instruction) => instruction.includes('specification label')));
});

test('returns no review reason when every automatic gate passes', () => {
  assert.deepEqual(operatorReviewReasons({
    opportunityReasons: ['weak_structure'], minimumCommercialDelta: 10,
    confidenceThreshold: 0.9, shopEnabled: true,
    result: {
      safetyPassed: true, commercialDelta: 18,
      proposed: { confidence: 0.9 },
      enrichmentEvaluation: {
        sourcePreserved: true, specificationConflicts: [], hasSubstantiveCommercialGain: true,
      },
    },
  }), []);
});
