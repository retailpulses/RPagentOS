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
      mode: 'auto', selected: 1, safetyPassed: 1, autoEligible: 1,
      canonicalApplied: 1, stale: 0, applyFailed: 0, runtimeMs: 12345, llmRequests: 2,
      results: [{
        listingId: 'listing-1', applyOutcome: 'updated', opportunityScore: 88,
        commercialDelta: 18, confidence: 0.9,
        diff: {
          titleChanged: false, beforeDescriptionLength: 20, afterDescriptionLength: 200,
          addedLines: ['追加行'], removedLines: [],
        },
      }],
    },
  });
  assert.match(content, /canonical updated/);
  assert.match(content, /Description: 20 → 200 chars/);
  assert.match(content, /\+ 追加行/);
  assert.ok(Buffer.byteLength(content, 'utf8') <= 3800);
});
