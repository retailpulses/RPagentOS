import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRenderableCopyClaims,
  materializeClaimSelection,
} from './claim-attribution.js';
import { evaluateAgainstBenchmark } from './benchmark.js';
import { type CopyBenchmark, type ListingClaimPack } from './types.js';

function suitcasePack(): ListingClaimPack {
  return {
    parentSpu: {
      spuCode: 'PP298906', productTypes: ['スーツケース', 'キャリーケース', 'キャリーバッグ'],
      sizes: ['S'], tripDuration: '2～3日', features: ['TSAロック'],
    },
    selectedVariant: {
      itemCode: null, weightKg: null, packageQuantity: null,
      countryOfOrigin: null, assemblyStatus: null,
    },
    commonAcrossChildren: {
      weightKg: 2.7, packageQuantity: 1, countryOfOrigin: '中国', assemblyStatus: '要組立品',
    },
    assortment: { strategy: 'single_size', childCount: 14, sizes: ['S'] },
    groundedNumericTokens: ['2.7kg', '1個', '2日', '3日', '2～3日'],
    unsupportedOrMissing: [
      '機内持ち込み', '360度キャスター', 'エンボス加工', 'メッシュポケット',
      '超軽量・軽量設計', 'color',
    ],
  };
}

test('renderable claim catalog quarantines suspicious suitcase assembly status', () => {
  const claims = buildRenderableCopyClaims(suitcasePack());
  assert.equal(claims.some((claim) => claim.id.endsWith('.assembly_status')), false);
  assert.ok(claims.some((claim) => claim.id === 'common_across_children.weight_kg'));
});

test('claim selection renders exact attributed copy without model-authored benefits', () => {
  const result = materializeClaimSelection({
    titleClaimIds: ['parent.product_types', 'parent.sizes', 'parent.feature.tsa_lock'],
    descriptionClaimIds: ['parent.feature.tsa_lock', 'common_across_children.weight_kg'],
  }, suitcasePack(), 0.9, 'Selected verified shopper facts');
  assert.deepEqual(result.errors, []);
  assert.equal(result.proposal.title, 'スーツケース キャリーケース キャリーバッグ Sサイズ TSAロック搭載');
  assert.equal(result.proposal.description, 'TSAロックを搭載しています。\n重量は2.7kgです。');
  assert.equal(result.proposal.description?.includes('便利'), false);
  assert.deepEqual(result.proposal.claimAttributions?.map((item) => item.claimId), [
    'parent.product_types', 'parent.sizes', 'parent.feature.tsa_lock',
    'parent.feature.tsa_lock', 'common_across_children.weight_kg',
  ]);
});

test('unknown or title-ineligible claims are rejected', () => {
  const result = materializeClaimSelection({
    titleClaimIds: ['unknown.claim', 'common_across_children.country_of_origin'],
    descriptionClaimIds: [],
  }, suitcasePack(), 0.9, 'R');
  assert.ok(result.errors.some((error) => error.includes('Unknown or unavailable')));
  assert.ok(result.errors.some((error) => error.includes('not allowed in the title')));
});

test('claim safety is a gate and does not inflate commercial benchmark score', () => {
  const benchmark: CopyBenchmark = {
    id: 'benchmark-1', marketplace: 'rakuten', categoryId: '301577', categoryName: 'スーツケース',
    scopeKey: 'suitcase:test', selectionMode: 'automatic', version: 1,
    sourceKind: 'rakuten_search_organic', capturedAt: '2026-08-11T00:00:00Z',
    titleTerms: ['スーツケース', 'Sサイズ', 'TSAロック'], descriptionTopics: [],
    assortment: { strategy: 'multi_size', observedSizes: ['S', 'M', 'L'], multiSizeListingCount: 7, multiSizeListingRatio: 0.7 },
    items: [],
  };
  const pack = suitcasePack();
  const safe = materializeClaimSelection({
    titleClaimIds: ['parent.product_types', 'parent.sizes', 'parent.feature.tsa_lock'],
    descriptionClaimIds: ['parent.feature.tsa_lock', 'common_across_children.weight_kg'],
  }, pack, 0.9, 'R').proposal;
  const evaluation = evaluateAgainstBenchmark({
    title: 'スーツケース Sサイズ 超軽量 ベージュ エンボス加工 TSAロック',
    description: '360度キャスターとメッシュポケットを搭載。ABS樹脂で大容量。',
    verified_claim_pack: pack,
  }, safe, benchmark);
  assert.ok(evaluation);
  assert.ok(evaluation!.unsupportedClaimsRemoved >= 5);
  assert.equal(evaluation!.beforeSafetyPassed, false);
  assert.equal(evaluation!.proposedSafetyPassed, true);
  assert.equal(evaluation!.scoreDelta, 0);
});
