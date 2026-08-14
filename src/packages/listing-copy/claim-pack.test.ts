import assert from 'node:assert/strict';
import test from 'node:test';

import { buildListingClaimPack } from './claim-pack.js';

test('buildListingClaimPack exposes only allowlisted SPU and selected-child evidence', () => {
  const pack = buildListingClaimPack({
    productSpu: {
      spu_code: 'PP298906',
      title: 'スーツケース キャリーケース Sサイズ 2～3泊 TSAロック',
    },
    selectedVariant: {
      item_code: 'PP298906DAA',
      variant_name: '兄弟コピーを証拠にしない 360度キャスター',
      color: '複数色',
      product_weight_kg: 2.7,
      package_quantity: 1,
      country_of_origin_ja: '中国',
      assembly_status: '要組立品',
    },
    spuVariants: Array.from({ length: 14 }, () => ({
      product_weight_kg: 2.7, package_quantity: 1,
      country_of_origin_ja: '中国', assembly_status: '要組立品',
    })),
    assortmentSizes: ['S'],
    childCount: 14,
  });

  assert.equal(pack.parentSpu.spuCode, 'PP298906');
  assert.deepEqual(pack.parentSpu.productTypes, ['スーツケース', 'キャリーケース']);
  assert.equal(pack.parentSpu.tripDuration, '2～3泊');
  assert.deepEqual(pack.parentSpu.features, ['TSAロック']);
  assert.equal(pack.selectedVariant.itemCode, 'PP298906DAA');
  assert.equal(pack.selectedVariant.weightKg, 2.7);
  assert.deepEqual(pack.commonAcrossChildren, {
    weightKg: 2.7, packageQuantity: 1, countryOfOrigin: '中国', assemblyStatus: '要組立品',
  });
  assert.deepEqual(pack.assortment, { strategy: 'single_size', childCount: 14, sizes: ['S'] });
  assert.ok(pack.groundedNumericTokens.includes('2.7kg'));
  assert.ok(pack.groundedNumericTokens.includes('2泊'));
  assert.equal(JSON.stringify(pack).includes('360度キャスター'), true);
  assert.equal(JSON.stringify(pack).includes('兄弟コピーを証拠にしない'), false);
  assert.equal(JSON.stringify(pack).includes('複数色'), false);
});

test('buildListingClaimPack does not infer M/L from sibling names or raw attributes', () => {
  const pack = buildListingClaimPack({
    productSpu: { spu_code: 'PP298906', title: 'スーツケース Sサイズ' },
    selectedVariant: { item_code: 'PP298906DAA', variant_name: 'M L 人気' },
    spuVariants: [],
    assortmentSizes: ['S'],
    childCount: 14,
  });
  assert.deepEqual(pack.parentSpu.sizes, ['S']);
  assert.equal(pack.assortment.strategy, 'single_size');
});

test('buildListingClaimPack normalizes adjacent trip days without using listing copy', () => {
  const pack = buildListingClaimPack({
    productSpu: { spu_code: 'PP298906', title: 'スーツケース Sサイズ 2日3日旅行' },
    assortmentSizes: ['S'],
    childCount: 14,
  });
  assert.equal(pack.parentSpu.tripDuration, '2～3日');
  assert.ok(pack.groundedNumericTokens.includes('2日'));
  assert.ok(pack.groundedNumericTokens.includes('3日'));
});
