import assert from 'node:assert/strict';
import test from 'node:test';

import { type CommercialQualityEvaluation } from './commercial-score.js';
import {
  composeStructuredEnrichmentDescription,
  evaluatePreserveFirstEnrichment,
} from './preserve-first-enrich.js';

function score(overrides: Partial<CommercialQualityEvaluation>): CommercialQualityEvaluation {
  return {
    total: 20, decisionCompleteness: 5, titleSearchQuality: 5,
    differentiation: 0, readability: 10,
    matchedDecisionFactors: ['identity'], matchedTitleTerms: ['product'],
    matchedDifferentiators: [], ...overrides,
  };
}

test('structured composer merges source and enrichment under one standard section set', () => {
  const source = [
    'ペットドライルームです。',
    '特徴',
    '【68L大容量】猫にも対応。',
    '商品仕様',
    'カラー：ホワイト',
    'おすすめの使用シーン',
    'お風呂上がりの乾燥に。',
  ].join('\n');
  const enrichment = [
    '【商品概要】',
    '乾燥を快適にサポート。',
    '【特徴・ベネフィット】',
    '【乾燥モード】',
    '3モードを搭載。',
    '【商品仕様】',
    '素材：ABS',
    '【使用シーン・おすすめ】',
    '雨の日の室内ケアに。',
    '【お手入れ・注意事項】',
    '除菌モードはペットを入れずに使用。',
  ].join('\n');
  const result = composeStructuredEnrichmentDescription(source, enrichment);

  for (const heading of ['商品概要', '特徴・ベネフィット', '商品仕様', '使用シーン・おすすめ', 'お手入れ・注意事項']) {
    assert.equal(result.description.split(`【${heading}】`).length - 1, 1);
  }
  assert.doesNotMatch(result.description, /追加情報/);
  assert.match(result.description, /【68L大容量】猫にも対応。/);
  assert.match(result.description, /【乾燥モード】\n3モードを搭載。/);
});

test('structured composer reports conflicting non-placeholder specifications', () => {
  const result = composeStructuredEnrichmentDescription(
    '商品仕様\n素材：布\n原産国：商品詳細をご確認ください',
    '【商品仕様】\n素材：ABS\n原産国：中国',
  );

  assert.equal(result.specificationConflicts.length, 1);
  assert.deepEqual(result.specificationConflicts[0]?.sourceValues, ['布']);
  assert.equal(result.specificationConflicts[0]?.enrichmentValue, 'ABS');
});

test('specification comparison treats a repeated label prefix as the same value', () => {
  const result = composeStructuredEnrichmentDescription(
    '商品仕様\n耐荷重：耐荷重180kg',
    '【商品仕様】\n耐荷重：180kg',
  );

  assert.deepEqual(result.specificationConflicts, []);
});

test('readability-only gain is not substantive and every source block remains covered', () => {
  const source = '現在の商品説明です。\n特徴\n既存の利用シーンも残します。';
  const composed = composeStructuredEnrichmentDescription(
    source,
    '【特徴・ベネフィット】\n読みやすい補足です。',
  );
  const evaluation = evaluatePreserveFirstEnrichment({
    sourceDescription: source, proposedDescription: composed.description,
    specificationConflicts: composed.specificationConflicts,
    beforeScore: score({ total: 20, readability: 10 }),
    proposedScore: score({ total: 25, readability: 15 }),
  });

  assert.equal(evaluation.sourcePreserved, true);
  assert.equal(evaluation.missingSourceBlocks.length, 0);
  assert.equal(evaluation.hasSubstantiveCommercialGain, false);
});

test('specification conflict blocks otherwise substantive enrichment', () => {
  const source = '商品仕様\n素材：布';
  const composed = composeStructuredEnrichmentDescription(source, '【商品仕様】\n素材：ABS');
  const evaluation = evaluatePreserveFirstEnrichment({
    sourceDescription: source, proposedDescription: composed.description,
    specificationConflicts: composed.specificationConflicts,
    beforeScore: score({}),
    proposedScore: score({ total: 35, matchedDecisionFactors: ['identity', 'material.abs'] }),
  });

  assert.equal(evaluation.sourcePreserved, true);
  assert.equal(evaluation.specificationConflicts.length, 1);
  assert.equal(evaluation.hasSubstantiveCommercialGain, false);
});
