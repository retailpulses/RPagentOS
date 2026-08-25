import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildImageFactPack,
  canonicalJson,
  detectImageFormat,
  hashCanonicalJson,
  MAIN_IMAGE_CANVAS_SIZE,
  MAIN_IMAGE_JSON_SCHEMA,
  readImageDimensions,
  signCandidateToken,
  validateMainImageBytes,
  validateMainImageSchema,
  verifyCandidateToken,
} from './core.js';
import type {
  CandidateTokenPayload,
  ImageFactPack,
  MainImageContext,
  MainImageSchema,
} from './core.js';

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

function baseContext(): MainImageContext {
  return {
    listing: {
      id: 'listing-1',
      platform: 'mercari',
      shopCode: 'shop2',
      externalListingId: 'm123',
      productSpuId: 'spu-1',
      selectedVariantId: 'var-1',
      title: '軽量 スーツケース',
      description: 'TSAロック搭載のキャリーケースです。',
      contentRevision: 3,
      imageUrls: ['https://example.com/old.jpg'],
    },
    spu: { id: 'spu-1', spuCode: 'PP-001', features: ['軽量', 'TSAロック'], attributes: { material: 'ABS' } },
    variants: [
      { id: 'var-1', productSpuId: 'spu-1', itemCode: 'PP-001-A', name: 'ベージュ', color: 'ベージュ', colorCode: 'BE', size: 'S', material: 'ABS', quantity: 1, isActive: true },
      { id: 'var-2', productSpuId: 'spu-1', itemCode: 'PP-001-B', name: null, color: 'ブラック', colorCode: 'BK', size: 'M', material: 'ABS', quantity: 1, isActive: true },
      { id: 'var-other', productSpuId: 'spu-2', itemCode: 'OTHER', name: '別SPU', color: '赤', colorCode: 'RD', size: 'L', material: null, quantity: 1, isActive: true },
    ],
    assets: [
      { id: 'asset-1', spuId: 'spu-1', variantId: 'var-1', url: 'https://example.com/a1.jpg', kind: 'main', width: 1024, height: 1024, contentType: 'image/jpeg', byteSize: 100, isUsable: true },
      { id: 'asset-2', spuId: 'spu-1', variantId: 'var-2', url: 'https://example.com/a2.jpg', kind: 'main', width: 1024, height: 1024, contentType: 'image/jpeg', byteSize: 100, isUsable: true },
      { id: 'asset-3', spuId: 'spu-1', variantId: null, url: 'https://example.com/a3.jpg', kind: 'detail', width: 1024, height: 1024, contentType: 'image/jpeg', byteSize: 100, isUsable: true },
      { id: 'asset-other', spuId: 'spu-2', variantId: null, url: 'https://example.com/other.jpg', kind: 'main', width: 1024, height: 1024, contentType: 'image/jpeg', byteSize: 100, isUsable: true },
    ],
    attributes: [
      { id: 'attr-1', entityType: 'spu', entityId: 'spu-1', name: 'material', value: 'ABS', isAllowlisted: true },
    ],
  };
}

function validSchema(): MainImageSchema {
  return {
    schema_version: '1.0',
    canvas: { width: 1024, height: 1024, background_color: '#F7F4EE' },
    product: {
      scale_percent: 73,
      alignment: 'center-right',
      preserve_original_product: true,
      source_asset_ids: ['asset-1'],
    },
    copy: {
      headline: 'ABS',
      headline_evidence_ids: ['variant.var-1.material'],
      supporting_text: '',
      supporting_evidence_ids: [],
    },
    feature_ids: ['variant.var-1.color'],
    keyword_ids: ['variant.var-2.size'],
    variation_swatches: [
      { variant_id: 'var-1', label: 'ベージュ', color: '#D8C3A5', source_asset_id: 'asset-1' },
    ],
    restrictions: {
      no_people: true,
      no_logo: true,
      no_fake_discount: true,
      no_fake_ranking: true,
      no_fake_certification: true,
      no_unverified_claims: true,
      no_product_modification: true,
    },
    notes: '',
  };
}

function pngBytes(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0x00, 0x00, 0x00, 0x0d], 8);
  b.set([0x49, 0x48, 0x44, 0x52], 12);
  b[16] = (width >>> 24) & 0xff; b[17] = (width >>> 16) & 0xff; b[18] = (width >>> 8) & 0xff; b[19] = width & 0xff;
  b[20] = (height >>> 24) & 0xff; b[21] = (height >>> 16) & 0xff; b[22] = (height >>> 8) & 0xff; b[23] = height & 0xff;
  b[24] = 8; b[25] = 2; b[26] = 0; b[27] = 0; b[28] = 0;
  return b;
}

function jpegBytes(width: number, height: number): Uint8Array {
  const b = new Uint8Array(30);
  b.set([0xff, 0xd8], 0);
  b.set([0xff, 0xe0, 0x00, 0x10], 2);
  b.set([0x4a, 0x46, 0x49, 0x46, 0x00], 6);
  b.set([0xff, 0xc0, 0x00, 0x11, 0x08], 20);
  b[25] = (height >>> 8) & 0xff; b[26] = height & 0xff;
  b[27] = (width >>> 8) & 0xff; b[28] = width & 0xff;
  b[29] = 0x03;
  return b;
}

function webpBytes(width: number, height: number): Uint8Array {
  const b = new Uint8Array(30);
  b.set([0x52, 0x49, 0x46, 0x46], 0);
  b.set([0x57, 0x45, 0x42, 0x50], 8);
  b.set([0x56, 0x50, 0x38, 0x58], 12);
  b.set([0x0a, 0x00, 0x00, 0x00], 16);
  const w = width - 1; const h = height - 1;
  b[24] = w & 0xff; b[25] = (w >>> 8) & 0xff; b[26] = (w >>> 16) & 0xff;
  b[27] = h & 0xff; b[28] = (h >>> 8) & 0xff; b[29] = (h >>> 16) & 0xff;
  return b;
}

function svgBytes(): Uint8Array {
  return new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"></svg>');
}

function tokenPayload(): CandidateTokenPayload {
  return {
    listingId: 'listing-1',
    contentRevision: 3,
    imageSha256: 'ab'.repeat(32),
    schemaHash: 'cd'.repeat(32),
    factPackHash: 'ef'.repeat(32),
    model: 'gpt-image-2',
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
}

/* ------------------------------------------------------------------ *
 * Fact-pack assembly
 * ------------------------------------------------------------------ */

test('buildImageFactPack keeps exact listing identity and same-SPU variants only', () => {
  const pack = buildImageFactPack(baseContext());

  assert.equal(pack.listingId, 'listing-1');
  assert.equal(pack.externalListingId, 'm123');
  assert.equal(pack.platform, 'mercari');
  assert.equal(pack.shopCode, 'shop2');
  assert.equal(pack.spuId, 'spu-1');
  assert.equal(pack.selectedVariantId, 'var-1');
  assert.equal(pack.contentRevision, 3);

  assert.deepEqual(pack.variantIds, ['var-1', 'var-2']);
  assert.ok(!pack.variantIds.includes('var-other'));
  assert.deepEqual(pack.assetIds, ['asset-1', 'asset-2', 'asset-3']);
  assert.ok(!pack.assetIds.includes('asset-other'));
  assert.ok(pack.warnings.some((w) => w.includes('outside the target SPU')));
});

test('buildImageFactPack is deterministic regardless of input order', () => {
  const a = buildImageFactPack(baseContext());
  const ctx = baseContext();
  ctx.variants.reverse();
  ctx.assets.reverse();
  ctx.attributes.reverse();
  const b = buildImageFactPack(ctx);

  assert.deepEqual(b, a);
  assert.equal(canonicalJson(b), canonicalJson(a));
});

test('buildImageFactPack tags canonical fields verified and title/description context_only', () => {
  const pack = buildImageFactPack(baseContext());

  const title = pack.evidence.find((e) => e.id === 'listing.title');
  const description = pack.evidence.find((e) => e.id === 'listing.description');
  const color = pack.evidence.find((e) => e.id === 'variant.var-1.color');
  const attribute = pack.evidence.find((e) => e.id === 'attribute.attr-1');
  const feature = pack.evidence.find((e) => e.kind === 'spu_feature');

  assert.ok(title);
  assert.equal(title.status, 'context_only');
  assert.ok(description);
  assert.equal(description.status, 'context_only');
  assert.ok(color);
  assert.equal(color.status, 'verified');
  assert.equal(color.value, 'ベージュ');
  assert.ok(attribute);
  assert.equal(attribute.status, 'verified');
  assert.ok(feature);
  assert.equal(feature.status, 'verified');
});

test('buildImageFactPack dedupes duplicate ids and warns on conflicts', () => {
  const ctx = baseContext();
  ctx.variants.push({
    id: 'var-1', productSpuId: 'spu-1', itemCode: 'PP-001-A-DIFFERENT', name: 'ベージュ',
    color: 'ベージュ', colorCode: 'BE', size: 'S', material: 'ABS', quantity: 1, isActive: true,
  });
  ctx.variants.push({
    id: 'var-1', productSpuId: 'spu-1', itemCode: 'PP-001-A', name: 'ベージュ',
    color: 'ベージュ', colorCode: 'BE', size: 'S', material: 'ABS', quantity: 1, isActive: true,
  });
  const pack = buildImageFactPack(ctx);

  assert.equal(pack.variantIds.filter((id) => id === 'var-1').length, 1);
  assert.ok(pack.warnings.some((w) => w.includes('duplicate variant id "var-1"')));
});

test('buildImageFactPack warns on missing SPU and no usable source images', () => {
  const ctx = baseContext();
  ctx.listing.productSpuId = null;
  ctx.spu = null;
  ctx.assets = ctx.assets.map((a) => ({ ...a, isUsable: false }));
  const pack = buildImageFactPack(ctx);

  assert.ok(pack.warnings.some((w) => w.includes('missing: listing.product_spu_id')));
  assert.ok(pack.warnings.some((w) => w.includes('missing: product SPU record')));
  assert.ok(pack.warnings.some((w) => w.includes('missing: no usable source images')));
  assert.deepEqual(pack.variantIds, []);
  assert.deepEqual(pack.assetIds, []);
});

/* ------------------------------------------------------------------ *
 * Canonical JSON + hashing
 * ------------------------------------------------------------------ */

test('canonicalJson sorts keys recursively and is stable across key order', () => {
  const a = { z: 1, a: { y: 2, b: [3, 2, 1] }, m: [1, 2] };
  const b = { m: [1, 2], a: { b: [3, 2, 1], y: 2 }, z: 1 };
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(canonicalJson(a), '{"a":{"b":[3,2,1],"y":2},"m":[1,2],"z":1}');
});

test('hashCanonicalJson returns a stable 64-char SHA-256 hex digest', async () => {
  const h1 = await hashCanonicalJson({ a: 1, b: [1, 2] });
  const h2 = await hashCanonicalJson({ b: [1, 2], a: 1 });
  const h3 = await hashCanonicalJson({ a: 1, b: [1, 3] });

  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
});

/* ------------------------------------------------------------------ *
 * Strict JSON schema
 * ------------------------------------------------------------------ */

test('MAIN_IMAGE_JSON_SCHEMA enforces strict square canvas and mandatory restrictions', () => {
  const s = MAIN_IMAGE_JSON_SCHEMA as Record<string, unknown>;
  assert.equal(s.additionalProperties, false);

  const props = s.properties as Record<string, Record<string, unknown>>;
  const canvas = props.canvas.properties as Record<string, { const?: unknown }>;
  assert.equal(canvas.width.const, 1024);
  assert.equal(canvas.height.const, 1024);

  const restrictions = props.restrictions.properties as Record<string, { const?: unknown }>;
  for (const key of Object.keys(restrictions)) {
    assert.equal(restrictions[key].const, true);
  }
  const required = props.restrictions.required as string[];
  assert.ok(required.includes('no_people'));
  assert.ok(required.includes('no_product_modification'));

  const swatch = (props.variation_swatches.items as Record<string, unknown>);
  assert.equal(swatch.additionalProperties, false);
});

/* ------------------------------------------------------------------ *
 * Schema validation
 * ------------------------------------------------------------------ */

test('validateMainImageSchema accepts a fully grounded schema using verified evidence', () => {
  const pack = buildImageFactPack(baseContext());
  const result = validateMainImageSchema(validSchema(), pack, []);
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});

test('validateMainImageSchema requires confirmation for context-only evidence', () => {
  const pack = buildImageFactPack(baseContext());
  const schema = validSchema();
  schema.copy.headline = '軽量 スーツケース';
  schema.copy.headline_evidence_ids = ['listing.title'];

  const without = validateMainImageSchema(schema, pack, []);
  assert.equal(without.valid, false);
  assert.ok(without.errors.some((e) => e.includes('unconfirmed context-only evidence')));

  const withConfirmation = validateMainImageSchema(schema, pack, new Set(['listing.title']));
  assert.equal(withConfirmation.valid, true);
});

test('validateMainImageSchema rejects unknown evidence, asset, and variant IDs', () => {
  const pack = buildImageFactPack(baseContext());

  const unknownEvidence = validSchema();
  unknownEvidence.feature_ids = ['nope'];
  assert.ok(validateMainImageSchema(unknownEvidence, pack, []).errors.some((e) => e.includes('unknown evidence ID')));

  const unknownAsset = validSchema();
  unknownAsset.product.source_asset_ids = ['nope'];
  assert.ok(validateMainImageSchema(unknownAsset, pack, []).errors.some((e) => e.includes('unknown asset')));

  const unknownVariant = validSchema();
  unknownVariant.variation_swatches = [{ variant_id: 'nope', label: 'x', color: '#000000', source_asset_id: 'asset-1' }];
  assert.ok(validateMainImageSchema(unknownVariant, pack, []).errors.some((e) => e.includes('not in the same SPU')));
});

test('validateMainImageSchema rejects asset-variant mismatches', () => {
  const pack = buildImageFactPack(baseContext());
  const schema = validSchema();
  schema.variation_swatches = [{ variant_id: 'var-1', label: 'ベージュ', color: '#D8C3A5', source_asset_id: 'asset-2' }];
  const result = validateMainImageSchema(schema, pack, []);
  assert.ok(result.errors.some((e) => e.includes('not linked to variant var-1')));
});

test('validateMainImageSchema rejects weakened restrictions', () => {
  const pack = buildImageFactPack(baseContext());
  const schema = validSchema();
  schema.restrictions.no_people = false;
  const result = validateMainImageSchema(schema, pack, []);
  assert.ok(result.errors.some((e) => e.includes('restrictions.no_people must be true')));
});

test('validateMainImageSchema requires preserving the original product', () => {
  const pack = buildImageFactPack(baseContext());
  const schema = validSchema();
  schema.product.preserve_original_product = false;
  const result = validateMainImageSchema(schema, pack, []);
  assert.ok(result.errors.some((e) => e.includes('product.preserve_original_product must be true')));
});

test('validateMainImageSchema rejects copy without evidence', () => {
  const pack = buildImageFactPack(baseContext());
  const schema = validSchema();
  schema.copy.supporting_text = '根拠のない訴求';
  const result = validateMainImageSchema(schema, pack, []);
  assert.ok(result.errors.some((e) => e.includes('supporting_text is non-empty but has no evidence links')));
});

test('validateMainImageSchema rejects copy that merely cites unrelated evidence', () => {
  const pack = buildImageFactPack(baseContext());
  const schema = validSchema();
  schema.copy.headline = '超軽量';
  schema.copy.headline_evidence_ids = ['variant.var-1.material'];
  const result = validateMainImageSchema(schema, pack, []);
  assert.ok(result.errors.some((e) => e.includes('does not contain cited evidence value')));
  assert.ok(result.errors.some((e) => e.includes('contains text not present in its cited evidence')));
});

test('validateMainImageSchema rejects a background outside the MVP palette', () => {
  const pack = buildImageFactPack(baseContext());
  const schema = validSchema();
  schema.canvas.background_color = '#000000';
  const result = validateMainImageSchema(schema, pack, []);
  assert.ok(result.errors.some((e) => e.includes('canvas.background_color must be one of')));
});

test('validateMainImageSchema rejects non-1024 canvas and out-of-range scale', () => {
  const pack = buildImageFactPack(baseContext());

  const badCanvas = validSchema();
  badCanvas.canvas.width = 1000;
  assert.ok(validateMainImageSchema(badCanvas, pack, []).errors.some((e) => e.includes('canvas.width must be 1024')));

  const badScale = validSchema();
  badScale.product.scale_percent = 200;
  assert.ok(validateMainImageSchema(badScale, pack, []).errors.some((e) => e.includes('scale_percent')));

  const badAlignment = validSchema();
  badAlignment.product.alignment = 'diagonal';
  assert.ok(validateMainImageSchema(badAlignment, pack, []).errors.some((e) => e.includes('alignment')));
});

test('validateMainImageSchema rejects duplicates and unknown keys', () => {
  const pack = buildImageFactPack(baseContext());

  const dup = validSchema();
  dup.feature_ids = ['variant.var-1.color', 'variant.var-1.color'];
  assert.ok(validateMainImageSchema(dup, pack, []).errors.some((e) => e.includes('duplicate ID')));

  const unknownKey = validSchema() as unknown as Record<string, unknown>;
  unknownKey.extra = true;
  const result = validateMainImageSchema(unknownKey as unknown as MainImageSchema, pack, []);
  assert.ok(result.errors.some((e) => e.includes('unknown key: extra')));
});

/* ------------------------------------------------------------------ *
 * Candidate tokens
 * ------------------------------------------------------------------ */

test('signCandidateToken and verifyCandidateToken round-trip', async () => {
  const secret = 'test-secret';
  const token = await signCandidateToken(tokenPayload(), secret);
  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

  const result = await verifyCandidateToken(token, secret);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payload.listingId, 'listing-1');
    assert.equal(result.payload.model, 'gpt-image-2');
  }
});

test('verifyCandidateToken rejects wrong secret and tampered signature', async () => {
  const secret = 'test-secret';
  const token = await signCandidateToken(tokenPayload(), secret);

  const wrongSecret = await verifyCandidateToken(token, 'other-secret');
  assert.equal(wrongSecret.ok, false);
  if (!wrongSecret.ok) assert.equal(wrongSecret.error, 'signature_mismatch');

  const parts = token.split('.');
  const last = parts[1].charAt(parts[1].length - 1);
  const flipped = last === 'a' ? 'b' : 'a';
  const tampered = `${parts[0]}.${parts[1].slice(0, -1)}${flipped}`;
  const tamperedResult = await verifyCandidateToken(tampered, secret);
  assert.equal(tamperedResult.ok, false);
  if (!tamperedResult.ok) assert.ok(['invalid_signature', 'signature_mismatch'].includes(tamperedResult.error));
});

test('verifyCandidateToken rejects a substituted payload', async () => {
  const secret = 'test-secret';
  const token = await signCandidateToken(tokenPayload(), secret);
  const signature = token.split('.')[1];

  const forged = { ...tokenPayload(), listingId: 'listing-2' };
  const forgedSegment = Buffer.from(JSON.stringify(forged)).toString('base64url');
  const result = await verifyCandidateToken(`${forgedSegment}.${signature}`, secret);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, 'signature_mismatch');
});

test('candidate tokens require an expiry', async () => {
  const secret = 'test-secret';

  await assert.rejects(
    signCandidateToken({ ...tokenPayload(), exp: undefined as unknown as number }, secret),
    /finite numeric exp/,
  );

  const token = await signCandidateToken(tokenPayload(), secret);
  const signature = token.split('.')[1];
  const noExp = { ...tokenPayload() } as Record<string, unknown>;
  delete noExp.exp;
  const forgedSegment = Buffer.from(JSON.stringify(noExp)).toString('base64url');
  const result = await verifyCandidateToken(`${forgedSegment}.${signature}`, secret);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, 'missing_expiry');
});

test('verifyCandidateToken enforces expiry', async () => {
  const secret = 'test-secret';
  const payload = tokenPayload();
  payload.exp = 1_000_000;
  const token = await signCandidateToken(payload, secret);

  const before = await verifyCandidateToken(token, secret, 999_999);
  assert.equal(before.ok, true);

  const atExpiry = await verifyCandidateToken(token, secret, 1_000_000);
  assert.equal(atExpiry.ok, false);
  if (!atExpiry.ok) assert.equal(atExpiry.error, 'expired');
});

/* ------------------------------------------------------------------ *
 * Image bytes
 * ------------------------------------------------------------------ */

test('detectImageFormat recognizes JPEG/PNG/WebP and rejects SVG/unknown', () => {
  assert.equal(detectImageFormat(jpegBytes(1024, 1024)), 'jpeg');
  assert.equal(detectImageFormat(pngBytes(1024, 1024)), 'png');
  assert.equal(detectImageFormat(webpBytes(1024, 1024)), 'webp');
  assert.equal(detectImageFormat(svgBytes()), null);
  assert.equal(detectImageFormat(new Uint8Array([1, 2, 3, 4])), null);
});

test('readImageDimensions reads dimensions without sharp', () => {
  assert.deepEqual(readImageDimensions(jpegBytes(1024, 800)), { width: 1024, height: 800 });
  assert.deepEqual(readImageDimensions(pngBytes(640, 640)), { width: 640, height: 640 });
  assert.deepEqual(readImageDimensions(webpBytes(1024, 1024)), { width: 1024, height: 1024 });
  assert.equal(readImageDimensions(svgBytes()), null);
});

test('validateMainImageBytes accepts a 1024x1024 raster image', () => {
  const result = validateMainImageBytes(pngBytes(1024, 1024), { expectedContentType: 'image/png' });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.info.format, 'png');
  assert.equal(result.info.width, 1024);
});

test('validateMainImageBytes rejects wrong dimensions, SVG, oversize, and content-type mismatch', () => {
  const wrongDims = validateMainImageBytes(pngBytes(640, 640));
  assert.equal(wrongDims.valid, false);
  assert.ok(wrongDims.errors.some((e) => e.includes('must be 1024x1024')));

  const svg = validateMainImageBytes(svgBytes());
  assert.equal(svg.valid, false);
  assert.ok(svg.errors.some((e) => e.includes('SVG is rejected')));

  const oversize = validateMainImageBytes(pngBytes(1024, 1024), { maxBytes: 10 });
  assert.equal(oversize.valid, false);
  assert.ok(oversize.errors.some((e) => e.includes('byte limit')));

  const mismatch = validateMainImageBytes(pngBytes(1024, 1024), { expectedContentType: 'image/jpeg' });
  assert.equal(mismatch.valid, false);
  assert.ok(mismatch.errors.some((e) => e.includes('does not match expected')));

  const empty = validateMainImageBytes(new Uint8Array(0));
  assert.equal(empty.valid, false);
});

test('image dimension helpers match the configured canvas size constant', () => {
  assert.equal(MAIN_IMAGE_CANVAS_SIZE, 1024);
  const pack: ImageFactPack = buildImageFactPack(baseContext());
  assert.ok(pack.assetIds.length >= 3);
});
