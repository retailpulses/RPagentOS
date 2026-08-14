import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGenericCopyProfile,
  buildGenericEvidenceFacts,
  evaluateGenericCommercialQuality,
  genericEvidenceValidationText,
  validateHardClaimAttributions,
} from './generic-profile.js';

const variants = [
  { raw_payload: { main_material: 'スチール', product_weight_kg: '12.5', main_color: '黒', product_features: '可動棚付き' } },
  { raw_payload: { main_material: 'スチール', product_weight_kg: '12.5', main_color: '白', product_features: '可動棚付き' } },
];

test('generic evidence includes SPU facts common across every child and excludes varying color', () => {
  const facts = buildGenericEvidenceFacts({
    productSpu: { spu_code: 'SPU-1', title: '収納キャビネット 可動棚付き' },
    spuVariants: variants,
  });
  assert.ok(facts.some((fact) => fact.value === 'スチール'));
  assert.ok(facts.some((fact) => fact.value === '12.5'));
  assert.ok(facts.some((fact) => fact.value === '可動棚付き'));
  assert.equal(facts.some((fact) => fact.value === '黒' || fact.value === '白'), false);
  assert.ok(facts.every((fact) => fact.sourceRef.length > 0));
});

test('generic profile and score work without a category-specific template', () => {
  const profile = buildGenericCopyProfile({
    categoryId: null, categoryName: null,
    productSpu: { spu_code: 'SPU-1', title: '収納キャビネット 可動棚付き' },
    spuVariants: variants,
  });
  const plain = evaluateGenericCommercialQuality({ title: '収納キャビネット', description: '収納家具です。' }, profile);
  const complete = evaluateGenericCommercialQuality({
    title: '収納キャビネット 可動棚付き スチール製 12.5kg',
    description: 'スチール製の収納キャビネットです。重量は12.5kgです。\n【特徴】可動棚付きです。',
  }, profile);
  assert.equal(profile.profileVersion, 'generic-v1');
  assert.ok(complete.total > plain.total);
});

test('hard claim attribution rejects unknown or missing evidence IDs', () => {
  const profile = buildGenericCopyProfile({
    categoryId: null, categoryName: null,
    productSpu: { spu_code: 'SPU-1', title: '収納キャビネット' },
    spuVariants: variants,
  });
  const knownId = profile.evidenceFacts.find((fact) => fact.value === 'スチール')!.id;
  assert.deepEqual(validateHardClaimAttributions([
    { text: '素材はスチール', evidenceIds: [knownId] },
  ], profile), []);
  assert.equal(validateHardClaimAttributions([
    { text: '防水仕様', evidenceIds: [] },
    { text: '永久保証', evidenceIds: ['missing'] },
  ], profile).length, 2);
});

test('generic validation evidence renders canonical numeric units', () => {
  const profile = buildGenericCopyProfile({
    categoryId: null, categoryName: null,
    productSpu: { spu_code: 'SPU-1', title: '収納キャビネット' },
    spuVariants: [
      { raw_payload: { 'assembled_size-width_cm': '90.00', product_weight_kg: '17.50' } },
      { raw_payload: { 'assembled_size-width_cm': '90.00', product_weight_kg: '17.50' } },
    ],
  });
  const evidence = genericEvidenceValidationText(profile);
  assert.match(evidence, /90cm/);
  assert.match(evidence, /17\.5kg/);
});
