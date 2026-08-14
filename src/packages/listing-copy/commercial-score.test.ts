import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateCommercialQuality, type CategoryCommercialProfile } from './commercial-score.js';

const suitcaseProfile: CategoryCommercialProfile = {
  decisionFactors: [
    { id: 'type', terms: ['スーツケース', 'キャリーケース'] },
    { id: 'size', terms: ['Sサイズ'] },
    { id: 'trip', terms: ['1～3泊', '1-3泊'] },
    { id: 'capacity', terms: ['41.1L'] },
    { id: 'dimensions', terms: ['56×37×24cm'] },
    { id: 'weight', terms: ['2.7kg'] },
    { id: 'material', terms: ['ABS+PC'] },
    { id: 'security', terms: ['TSAロック', 'TSAダイヤルロック'] },
    { id: 'mobility', terms: ['360度', 'キャスター'] },
    { id: 'interior', terms: ['クロスベルト', 'メッシュポケット'] },
  ],
  titleTerms: [
    { id: 'suitcase', terms: ['スーツケース'] },
    { id: 's_size', terms: ['Sサイズ'] },
    { id: 'carry_case', terms: ['キャリーケース'] },
    { id: 'tsa', terms: ['TSAロック'] },
    { id: 'travel', terms: ['旅行', '泊'] },
    { id: 'caster', terms: ['キャスター'] },
    { id: 'capacity', terms: ['L'] },
    { id: 'weight', terms: ['kg'] },
  ],
  differentiators: [
    { id: 'capacity', terms: ['41.1L'] },
    { id: 'caster', terms: ['50mm', '360度'] },
    { id: 'security', terms: ['TSAダイヤルロック'] },
    { id: 'interior', terms: ['クロスベルト', 'メッシュポケット'] },
    { id: 'shell', terms: ['ABS+PC', 'エンボス加工'] },
  ],
  preferredTitleLength: { min: 35, max: 100 },
  preferredDescriptionLength: { min: 140, max: 1200 },
  productTypeTerms: ['スーツケース', 'キャリーケース'],
};

test('commercial score rewards category completeness without deciding claim safety', () => {
  const plain = evaluateCommercialQuality({
    title: 'スーツケース キャリーケース Sサイズ TSAロック 2.7kg',
    description: 'Sサイズのスーツケースです。TSAロックを搭載しています。重量は2.7kgです。',
  }, suitcaseProfile);
  const enriched = evaluateCommercialQuality({
    title: 'スーツケース Sサイズ キャリーケース 旅行用 1～3泊 41.1L 2.7kg TSAロック 360度キャスター ABS+PC',
    description: '1～3泊の旅行に適したSサイズのスーツケースです。容量は約41.1L、外寸は約56×37×24cm、重量は約2.7kgです。\n【特徴】直径50mmの360度回転キャスターとTSAダイヤルロックを搭載。\n【内装】クロスベルトとメッシュポケット付き。\n【素材】ABS+PC混合樹脂、エンボス加工です。',
  }, suitcaseProfile);

  assert.ok(enriched.total > plain.total);
  assert.equal(enriched.decisionCompleteness, 40);
  assert.equal(enriched.differentiation, 20);
});
