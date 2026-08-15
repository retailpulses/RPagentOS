import assert from 'node:assert/strict';
import test from 'node:test';

import { buildListingCopyDiff, buildWecomCopyReport } from './wecom-report.js';

test('builds a preserve-first line diff', () => {
  const diff = buildListingCopyDiff({
    beforeTitle: '収納棚', afterTitle: '収納棚',
    beforeDescription: '既存の商品説明です。',
    afterDescription: '【商品概要】\n既存の商品説明です。\n【特徴】\n整理しやすい設計です。',
  });
  assert.equal(diff.titleChanged, false);
  assert.deepEqual(diff.removedLines, []);
  assert.deepEqual(diff.addedLines, ['【商品概要】', '【特徴】', '整理しやすい設計です。']);
});

test('formats a bounded WeCom job report', () => {
  const content = buildWecomCopyReport({
    jobStatus: 'success', runUrl: 'https://example.test/run/1',
    report: {
      mode: 'auto', selected: 1, lowQualityFound: 1, sentToPipeline: 1,
      safetyPassed: 1, autoEligible: 1, needsOperatorReview: 0,
      autoEligibilityRate: 1, autoUpdateRate: 1,
      canonicalApplied: 1, stale: 0, applyFailed: 0, runtimeMs: 12345,
      llmRequests: 2, modelRepairAttempts: 0,
      results: [{
        listingId: 'listing-1', applyOutcome: 'updated', opportunityScore: 88,
        disposition: 'auto_updated', commercialDelta: 18, confidence: 0.9,
        diff: {
          titleChanged: false, beforeDescriptionLength: 20, afterDescriptionLength: 200,
          addedLines: ['追加行'], removedLines: [],
        },
      }],
    },
  });
  assert.match(content, /canonical updated/);
  assert.match(content, /Low quality found: 1 \| Sent to pipeline: 1/);
  assert.match(content, /Auto eligibility\/update rate: 100\.0% \/ 100\.0%/);
  assert.match(content, /Description: 20 → 200 chars/);
  assert.match(content, /\+ 追加行/);
  assert.ok(Buffer.byteLength(content, 'utf8') <= 3800);
});

test('reports optional operator-review reasons', () => {
  const content = buildWecomCopyReport({
    jobStatus: 'success',
    report: {
      mode: 'auto', selected: 1, lowQualityFound: 1, sentToPipeline: 1,
      safetyPassed: 1, autoEligible: 0, needsOperatorReview: 1,
      canonicalApplied: 0, stale: 0, applyFailed: 0, runtimeMs: 1000,
      llmRequests: 4, modelRepairAttempts: 1,
      operatorReviewReasonCounts: { specification_conflict: 1 },
      results: [{
        listingId: 'listing-2', disposition: 'needs_operator_review', applyOutcome: 'skipped',
        operatorReviewReasons: ['specification_conflict'],
      }],
    },
  });
  assert.match(content, /Needs operator review: specification_conflict/);
  assert.match(content, /Repair attempts: 1/);
});
