import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateCopyOpportunity } from './opportunity-score.js';

test('prioritizes short, unstructured low-coverage copy', () => {
  const result = calculateCopyOpportunity({
    title: '収納ラック', description: '便利な商品です。', commercialScore: 18,
  });
  assert.equal(result.score, 100);
  assert.deepEqual(result.reasons, ['short_title', 'short_description', 'weak_structure', 'thin_information']);
});

test('keeps strong structured copy below the default live threshold', () => {
  const result = calculateCopyOpportunity({
    title: '木製収納ラック 幅60cm リビング向け シンプルデザイン',
    description: '【商品概要】\n収納ラックです。\n【特徴】\n用途に合わせて整理できます。\n【商品仕様】\n詳細をご確認ください。',
    commercialScore: 76,
  });
  assert.equal(result.score, 34);
  assert.ok(result.score < 35);
});
