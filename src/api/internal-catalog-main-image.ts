import {
  bearerToken,
  json,
  postgrestIn,
  supabaseRows,
  tokensEqual,
  type InternalCatalogEnv,
} from './internal-catalog.js';
import {
  MAIN_IMAGE_JSON_SCHEMA,
  buildImageFactPack,
  detectImageFormat,
  hashCanonicalJson,
  readImageDimensions,
  signCandidateToken,
  validateMainImageBytes,
  validateMainImageSchema,
  verifyCandidateToken,
  type ImageFactPack,
  type MainImageAsset,
  type MainImageAttribute,
  type MainImageContext,
  type MainImageSchema,
  type MainImageSpu,
  type MainImageVariant,
} from '../packages/main-image/core.js';
import {
  requestMainImageCandidate,
  requestMainImageSchema,
  type FetchLike,
  type OpenAiSourceImage,
} from '../packages/main-image/openai.js';

const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MAX_SOURCE_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_SOURCE_IMAGES = 4;
const MAX_JSON_BODY_BYTES = 20 * 1024 * 1024;
const MAX_OPERATOR_OVERRIDES = 100;
const MAX_OPERATOR_OVERRIDE_BYTES = 4 * 1024;
const CANDIDATE_TTL_SECONDS = 30 * 60;
const SCHEMA_PROMPT_VERSION = 'main-image-schema-v1';
const ALLOWED_ATTRIBUTE_KEYS = new Set([
  'color', 'colour', 'size', 'size_text', 'material', 'material_ja',
  'quantity', 'package_quantity', 'country_of_origin', 'country_of_origin_ja',
  'assembly_status', 'dimensions', 'width', 'height', 'length', 'weight',
]);

class MainImageHttpError extends Error {
  constructor(public status: number, public code: string, public details?: unknown) {
    super(code);
  }
}

interface LoadedMainImageContext {
  context: MainImageContext;
  factPack: ImageFactPack;
  factPackHash: string;
  listing: Record<string, unknown>;
  selectedVariant: Record<string, unknown>;
}

function mainImageConfigured(env: InternalCatalogEnv): boolean {
  return Boolean(
    env.INTERNAL_CATALOG_API_TOKEN
    && env.SUPABASE_URL
    && env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

function mainImageAuthorized(request: Request, env: InternalCatalogEnv): boolean {
  const token = bearerToken(request);
  return Boolean(token && env.INTERNAL_CATALOG_API_TOKEN && tokensEqual(token, env.INTERNAL_CATALOG_API_TOKEN));
}

function requireListingId(value: string): void {
  if (!UUID_RE.test(value)) throw new MainImageHttpError(400, 'invalid_listing_id');
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MainImageHttpError(400, 'invalid_request');
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(record: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(record).filter((key) => !allowedSet.has(key)).sort();
  if (unknown.length > 0) throw new MainImageHttpError(400, `unknown_key_${unknown[0]}`);
}

async function requestObject(request: Request, allowed: readonly string[]): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_JSON_BODY_BYTES) throw new MainImageHttpError(413, 'request_too_large');
  let text: string;
  try { text = await request.text(); } catch { throw new MainImageHttpError(400, 'invalid_json'); }
  if (text.length > MAX_JSON_BODY_BYTES) throw new MainImageHttpError(413, 'request_too_large');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new MainImageHttpError(400, 'invalid_json'); }
  const record = requireObject(value);
  rejectUnknownKeys(record, allowed);
  return record;
}

function operatorOverrides(value: unknown): Record<string, unknown>[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_OPERATOR_OVERRIDES) {
    throw new MainImageHttpError(400, 'invalid_operator_overrides');
  }
  return value.map((entry) => {
    const record = requireObject(entry);
    if (JSON.stringify(record).length > MAX_OPERATOR_OVERRIDE_BYTES) {
      throw new MainImageHttpError(400, 'invalid_operator_overrides');
    }
    return record;
  });
}

function expectedRevision(record: Record<string, unknown>): number {
  const value = record.expected_content_revision;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new MainImageHttpError(400, 'invalid_expected_revision');
  }
  return value;
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new MainImageHttpError(400, `invalid_${label}`);
  }
  const result = value.map((entry) => (entry as string).trim()).filter(Boolean);
  if (new Set(result).size !== result.length) throw new MainImageHttpError(400, `duplicate_${label}`);
  return result;
}

function responseForError(error: unknown): Response {
  if (error instanceof MainImageHttpError) {
    return json({ error: error.code, ...(error.details === undefined ? {} : { details: error.details }) }, error.status);
  }
  console.error('main-image owner API failed', error);
  return json({ error: 'main_image_upstream_error' }, 502);
}

function supabaseEnv(env: InternalCatalogEnv): { SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY: string } {
  return { SUPABASE_URL: env.SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY! };
}

function restUrl(env: InternalCatalogEnv, table: string, params: Record<string, string> = {}): URL {
  const url = new URL(`/rest/v1/${table}`, env.SUPABASE_URL!.replace(/\/$/, ''));
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

function restHeaders(env: InternalCatalogEnv, extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY!,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY!}`,
    accept: 'application/json',
    ...extra,
  };
}

async function postgrestInsert(
  env: InternalCatalogEnv,
  table: string,
  rows: Record<string, unknown>[],
  fetchFn: FetchLike,
  onConflict?: string,
): Promise<Record<string, unknown>[]> {
  const params: Record<string, string> = onConflict ? { on_conflict: onConflict } : {};
  const response = await fetchFn(restUrl(env, table, params), {
    method: 'POST',
    headers: restHeaders(env, {
      'content-type': 'application/json',
      prefer: `${onConflict ? 'resolution=merge-duplicates,' : ''}return=representation`,
    }),
    body: JSON.stringify(rows),
  });
  if (!response.ok) throw new Error(`insert_${table}_${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body)) throw new Error(`insert_${table}_invalid_response`);
  return body as Record<string, unknown>[];
}

async function postgrestPatch(
  env: InternalCatalogEnv,
  table: string,
  filters: Record<string, string>,
  body: Record<string, unknown>,
  fetchFn: FetchLike,
): Promise<Record<string, unknown> | null> {
  const response = await fetchFn(restUrl(env, table, filters), {
    method: 'PATCH',
    headers: restHeaders(env, { 'content-type': 'application/json', prefer: 'return=representation' }),
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`patch_${table}_${response.status}`);
  const rows = await response.json();
  return Array.isArray(rows) && rows.length > 0 ? rows[0] as Record<string, unknown> : null;
}

async function postgrestDelete(
  env: InternalCatalogEnv,
  table: string,
  filters: Record<string, string>,
  fetchFn: FetchLike,
): Promise<void> {
  const response = await fetchFn(restUrl(env, table, filters), {
    method: 'DELETE',
    headers: restHeaders(env),
  });
  if (!response.ok) throw new Error(`delete_${table}_${response.status}`);
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function assetMetadataValue(row: Record<string, unknown>, key: string): unknown {
  return metadataRecord(row.metadata)[key] ?? metadataRecord(row.raw_payload)[key];
}

function listedImageUrls(listing: Record<string, unknown>, imageRows: Record<string, unknown>[]): string[] {
  const ordered = imageRows
    .sort((a, b) => Number(a.image_position ?? 0) - Number(b.image_position ?? 0))
    .map((row) => asString(row.image_url))
    .filter((value): value is string => value !== null);
  const fallback = asStringArray(listing.images);
  return ordered.length > 0 ? ordered : fallback;
}

async function loadMainImageContext(
  env: InternalCatalogEnv,
  listingId: string,
  fetchFn: FetchLike,
): Promise<LoadedMainImageContext> {
  const db = supabaseEnv(env);
  const listingRows = await supabaseRows(db, 'platform_listings', {
    select: [
      'id', 'platform', 'shop_code', 'external_listing_id', 'listing_status',
      'product_family_id', 'product_spu_id', 'variant_id', 'title', 'description',
      'images', 'observed_images', 'content_revision', 'lifecycle_stage',
      'publish_claim_id', 'publish_idempotency_key', 'published_at',
    ].join(','),
    id: `eq.${listingId}`,
    limit: '2',
  }, fetchFn) as Record<string, unknown>[];
  if (listingRows.length === 0) throw new MainImageHttpError(404, 'listing_not_found');
  if (listingRows.length !== 1) throw new MainImageHttpError(409, 'ambiguous_listing');
  const listing = listingRows[0];
  if (listing.platform !== 'mercari' || !asString(listing.shop_code) || !asString(listing.external_listing_id)) {
    throw new MainImageHttpError(409, 'listing_not_publishable');
  }
  const productSpuId = asString(listing.product_spu_id);
  const selectedVariantId = asString(listing.variant_id);
  if (!selectedVariantId) throw new MainImageHttpError(409, 'missing_selected_variant');

  const [spuRows, variantRows, imageRows, attributeRows] = await Promise.all([
    productSpuId
      ? supabaseRows(db, 'product_spus', {
        select: 'id,spu_code,title,category,status,raw_payload', id: `eq.${productSpuId}`, limit: '2',
      }, fetchFn) as Promise<Record<string, unknown>[]>
      : Promise.resolve([]),
    productSpuId
      ? supabaseRows(db, 'product_variants', {
        select: [
          'id', 'product_spu_id', 'item_code', 'variant_name', 'color', 'color_code',
          'size_text', 'material', 'material_ja', 'package_quantity', 'status',
        ].join(','),
        product_spu_id: `eq.${productSpuId}`,
        order: 'item_code.asc,id.asc',
      }, fetchFn) as Promise<Record<string, unknown>[]>
      : supabaseRows(db, 'product_variants', {
        select: [
          'id', 'product_spu_id', 'item_code', 'variant_name', 'color', 'color_code',
          'size_text', 'material', 'material_ja', 'package_quantity', 'status',
        ].join(','),
        id: `eq.${selectedVariantId}`,
        limit: '2',
      }, fetchFn) as Promise<Record<string, unknown>[]>,
    supabaseRows(db, 'platform_listing_images', {
      select: 'id,image_position,image_url,image_path,image_name,image_type,content_revision',
      listing_id: `eq.${listingId}`,
      order: 'image_position.asc',
    }, fetchFn) as Promise<Record<string, unknown>[]>,
    supabaseRows(db, 'platform_listing_attributes', {
      select: 'id,listing_id,sku_id,attribute_key,attribute_value,attribute_unit,source',
      listing_id: `eq.${listingId}`,
      order: 'attribute_position.asc,id.asc',
    }, fetchFn) as Promise<Record<string, unknown>[]>,
  ]);

  const selectedVariant = variantRows.find((row) => row.id === selectedVariantId);
  if (!selectedVariant) throw new MainImageHttpError(409, 'selected_variant_not_in_product_spu');
  const resolvedSpuId = productSpuId ?? asString(selectedVariant.product_spu_id);
  const sameSpuVariants = resolvedSpuId
    ? (productSpuId ? variantRows : await supabaseRows(db, 'product_variants', {
      select: [
        'id', 'product_spu_id', 'item_code', 'variant_name', 'color', 'color_code',
        'size_text', 'material', 'material_ja', 'package_quantity', 'status',
      ].join(','),
      product_spu_id: `eq.${resolvedSpuId}`,
      order: 'item_code.asc,id.asc',
    }, fetchFn) as Record<string, unknown>[])
    : [selectedVariant];
  const resolvedSpuRows = productSpuId || !resolvedSpuId ? spuRows : await supabaseRows(db, 'product_spus', {
    select: 'id,spu_code,title,category,status,raw_payload', id: `eq.${resolvedSpuId}`, limit: '2',
  }, fetchFn) as Record<string, unknown>[];
  if (resolvedSpuRows.length > 1) throw new MainImageHttpError(409, 'ambiguous_product_spu');

  const variantIds = sameSpuVariants.map((row) => asString(row.id)).filter((id): id is string => id !== null);
  const assetOr: string[] = [];
  if (resolvedSpuId) assetOr.push(`product_spu_id.eq.${resolvedSpuId}`);
  if (variantIds.length > 0) assetOr.push(`variant_id.${postgrestIn(variantIds)}`);
  const assetRows = assetOr.length > 0
    ? await supabaseRows(db, 'product_assets', {
      select: 'id,product_spu_id,variant_id,asset_type,asset_url,asset_path,position,source_system,metadata,raw_payload',
      or: `(${assetOr.join(',')})`,
      order: 'position.asc,id.asc',
    }, fetchFn) as Record<string, unknown>[]
    : [];

  const variants: MainImageVariant[] = sameSpuVariants.map((row) => ({
    id: String(row.id),
    productSpuId: asString(row.product_spu_id) ?? '',
    itemCode: asString(row.item_code),
    name: asString(row.variant_name),
    color: asString(row.color),
    colorCode: asString(row.color_code),
    size: asString(row.size_text),
    material: asString(row.material_ja) ?? asString(row.material),
    quantity: asNumber(row.package_quantity),
    isActive: row.status !== 'inactive' && row.status !== 'archived',
  }));
  const assets: MainImageAsset[] = assetRows.map((row) => {
    const url = asString(row.asset_url);
    const assetType = asString(row.asset_type);
    return {
      id: String(row.id),
      spuId: asString(row.product_spu_id),
      variantId: asString(row.variant_id),
      url,
      kind: assetType,
      width: asNumber(assetMetadataValue(row, 'width')),
      height: asNumber(assetMetadataValue(row, 'height')),
      contentType: asString(assetMetadataValue(row, 'content_type')),
      byteSize: asNumber(assetMetadataValue(row, 'byte_size')),
      isUsable: assetType === 'image' && url !== null && safeSourceUrl(url),
    };
  });
  const attributes: MainImageAttribute[] = attributeRows.map((row) => {
    const name = asString(row.attribute_key) ?? '';
    return {
      id: String(row.id),
      entityType: 'listing',
      entityId: listingId,
      name,
      value: row.attribute_value,
      isAllowlisted: ALLOWED_ATTRIBUTE_KEYS.has(name.toLowerCase()),
    };
  });
  const spuRow = resolvedSpuRows[0];
  const spu: MainImageSpu | null = spuRow ? {
    id: String(spuRow.id),
    spuCode: asString(spuRow.spu_code),
    features: [],
    attributes: {},
  } : null;
  const context: MainImageContext = {
    listing: {
      id: listingId,
      platform: String(listing.platform),
      shopCode: String(listing.shop_code),
      externalListingId: String(listing.external_listing_id),
      productSpuId: resolvedSpuId,
      selectedVariantId,
      title: asString(listing.title),
      description: asString(listing.description),
      contentRevision: Number(listing.content_revision ?? 1),
      imageUrls: listedImageUrls(listing, imageRows),
    },
    spu,
    variants,
    assets,
    attributes,
  };
  const factPack = buildImageFactPack(context);
  const factPackHash = await hashCanonicalJson(factPack);
  return { context, factPack, factPackHash, listing, selectedVariant };
}

function safeSourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local')) return false;
    const bareHost = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
    if (bareHost.includes(':')) {
      if (bareHost === '::' || bareHost === '::1' || bareHost.startsWith('fc') || bareHost.startsWith('fd')
        || /^fe[89ab]/u.test(bareHost) || bareHost.startsWith('::ffff:')) return false;
    }
    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
      const octets = ipv4.slice(1).map(Number);
      if (octets.some((part) => part > 255)) return false;
      const [a, b, c] = octets;
      if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
        || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168) || (a === 192 && b === 0 && (c === 0 || c === 2))
        || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
        || (a === 203 && b === 0 && c === 113)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let output = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    output += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(output);
}

function base64ToBytes(value: unknown): Uint8Array {
  if (typeof value !== 'string' || !value || value.length > 16 * 1024 * 1024) {
    throw new MainImageHttpError(400, 'invalid_candidate_base64');
  }
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new MainImageHttpError(400, 'invalid_candidate_base64');
  }
}

async function hashBytes(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function sourceContentType(format: ReturnType<typeof detectImageFormat>): OpenAiSourceImage['contentType'] | null {
  if (format === 'jpeg') return 'image/jpeg';
  if (format === 'png') return 'image/png';
  if (format === 'webp') return 'image/webp';
  return null;
}

async function fetchVerifiedSourceImage(asset: MainImageAsset, fetchFn: FetchLike): Promise<OpenAiSourceImage> {
  if (!asset.url || !safeSourceUrl(asset.url)) throw new MainImageHttpError(400, 'invalid_source_image_url');
  const response = await fetchFn(asset.url, { redirect: 'error' });
  if (!response.ok) throw new MainImageHttpError(502, 'source_image_fetch_failed');
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > MAX_SOURCE_IMAGE_BYTES) throw new MainImageHttpError(400, 'source_image_too_large');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_SOURCE_IMAGE_BYTES) {
    throw new MainImageHttpError(400, 'source_image_too_large');
  }
  const contentType = sourceContentType(detectImageFormat(bytes));
  if (!contentType || !readImageDimensions(bytes)) throw new MainImageHttpError(400, 'invalid_source_image');
  return { bytes, contentType, filename: `source-${asset.id}.${contentType.split('/')[1]}` };
}

function ensureHandlerBase(request: Request, env: InternalCatalogEnv, listingId: string, method: string): Response | null {
  if (request.method !== method) return json({ error: 'method_not_allowed' }, 405, { allow: method });
  if (!mainImageConfigured(env)) return json({ error: 'service_not_configured' }, 503);
  if (!mainImageAuthorized(request, env)) return json({ error: 'unauthorized' }, 401);
  try { requireListingId(listingId); } catch (error) { return responseForError(error); }
  return null;
}

export async function handleMainImageContext(
  request: Request,
  env: InternalCatalogEnv,
  listingId: string,
  fetchFn: FetchLike = fetch,
): Promise<Response> {
  const early = ensureHandlerBase(request, env, listingId, 'GET');
  if (early) return early;
  try {
    const loaded = await loadMainImageContext(env, listingId, fetchFn);
    if (loaded.factPack.assetIds.length === 0) throw new MainImageHttpError(409, 'no_usable_source_image');
    return json({
      listing: loaded.context.listing,
      spu: loaded.context.spu,
      variants: loaded.context.variants,
      assets: loaded.context.assets,
      fact_pack: loaded.factPack,
      fact_pack_hash: loaded.factPackHash,
    });
  } catch (error) { return responseForError(error); }
}

export async function handleMainImageSchema(
  request: Request,
  env: InternalCatalogEnv,
  listingId: string,
  fetchFn: FetchLike = fetch,
): Promise<Response> {
  const early = ensureHandlerBase(request, env, listingId, 'POST');
  if (early) return early;
  if (!env.OPENAI_API_KEY) return json({ error: 'generation_not_configured' }, 503);
  try {
    const body = await requestObject(request, ['expected_content_revision']);
    const revision = expectedRevision(body);
    const loaded = await loadMainImageContext(env, listingId, fetchFn);
    if (loaded.context.listing.contentRevision !== revision) throw new MainImageHttpError(409, 'stale_revision');
    if (loaded.factPack.assetIds.length === 0) throw new MainImageHttpError(409, 'no_usable_source_image');
    const model = env.OPENAI_SCHEMA_MODEL || 'gpt-5.4';
    const schema = await requestMainImageSchema({
      apiKey: env.OPENAI_API_KEY,
      model,
      factPack: loaded.factPack,
      jsonSchema: MAIN_IMAGE_JSON_SCHEMA,
      fetchFn,
    }) as MainImageSchema;
    const validation = validateMainImageSchema(schema, loaded.factPack, []);
    return json({
      fact_pack: loaded.factPack,
      fact_pack_hash: loaded.factPackHash,
      schema,
      validation,
      model,
      prompt_version: SCHEMA_PROMPT_VERSION,
      input_hash: await hashCanonicalJson({ fact_pack_hash: loaded.factPackHash, model, prompt: SCHEMA_PROMPT_VERSION }),
    });
  } catch (error) { return responseForError(error); }
}

export async function handleMainImageCandidate(
  request: Request,
  env: InternalCatalogEnv,
  listingId: string,
  fetchFn: FetchLike = fetch,
): Promise<Response> {
  const early = ensureHandlerBase(request, env, listingId, 'POST');
  if (early) return early;
  if (!env.OPENAI_API_KEY || !env.MAIN_IMAGE_CANDIDATE_SIGNING_SECRET) {
    return json({ error: 'generation_not_configured' }, 503);
  }
  try {
    const body = await requestObject(request, [
      'expected_content_revision', 'fact_pack_hash', 'confirmed_context_evidence_ids', 'schema',
    ]);
    const revision = expectedRevision(body);
    const factPackHash = asString(body.fact_pack_hash);
    if (!factPackHash) throw new MainImageHttpError(400, 'invalid_fact_pack_hash');
    const confirmed = stringList(body.confirmed_context_evidence_ids ?? [], 'confirmed_context_evidence_ids');
    const schema = requireObject(body.schema) as unknown as MainImageSchema;
    const loaded = await loadMainImageContext(env, listingId, fetchFn);
    if (loaded.context.listing.contentRevision !== revision) throw new MainImageHttpError(409, 'stale_revision');
    if (loaded.factPackHash !== factPackHash) throw new MainImageHttpError(409, 'stale_fact_pack');
    const validation = validateMainImageSchema(schema, loaded.factPack, confirmed);
    if (!validation.valid) throw new MainImageHttpError(400, 'schema_validation_failed', validation);

    const assetById = new Map(loaded.factPack.assets.map((asset) => [asset.id, asset]));
    const sourceIds = schema.product.source_asset_ids;
    if (sourceIds.length > MAX_SOURCE_IMAGES) throw new MainImageHttpError(400, 'too_many_source_images');
    const sources = await Promise.all(sourceIds.map((id) => {
      const asset = assetById.get(id);
      if (!asset) throw new MainImageHttpError(400, 'unknown_source_image');
      return fetchVerifiedSourceImage(asset, fetchFn);
    }));
    const model = env.OPENAI_IMAGE_MODEL || 'gpt-image-2';
    const candidateBytes = await requestMainImageCandidate({
      apiKey: env.OPENAI_API_KEY, model, schema, sourceImages: sources, fetchFn,
    });
    const candidateValidation = validateMainImageBytes(candidateBytes, { expectedContentType: 'image/jpeg' });
    if (!candidateValidation.valid) {
      throw new MainImageHttpError(502, 'generated_image_invalid', candidateValidation.errors);
    }
    const imageSha256 = await hashBytes(candidateBytes);
    const schemaHash = await hashCanonicalJson(schema);
    const token = await signCandidateToken({
      listingId,
      contentRevision: revision,
      imageSha256,
      schemaHash,
      factPackHash,
      model,
      exp: Math.floor(Date.now() / 1000) + CANDIDATE_TTL_SECONDS,
    }, env.MAIN_IMAGE_CANDIDATE_SIGNING_SECRET);
    return json({
      candidate_base64: bytesToBase64(candidateBytes),
      candidate_token: token,
      provider: 'openai',
      model,
      content_type: candidateValidation.info.contentType,
      width: candidateValidation.info.width,
      height: candidateValidation.info.height,
      image_sha256: imageSha256,
      schema_hash: schemaHash,
      fact_pack_hash: factPackHash,
    });
  } catch (error) { return responseForError(error); }
}

function publicAssetUrl(base: string, key: string): string {
  return `${base.replace(/\/$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export async function handleMainImageAssetSave(
  request: Request,
  env: InternalCatalogEnv,
  listingId: string,
  fetchFn: FetchLike = fetch,
): Promise<Response> {
  const early = ensureHandlerBase(request, env, listingId, 'POST');
  if (early) return early;
  if (!env.MAIN_IMAGE_CANDIDATE_SIGNING_SECRET || !env.MAIN_IMAGE_ASSETS || !env.MAIN_IMAGE_ASSET_PUBLIC_BASE_URL) {
    return json({ error: 'asset_storage_not_configured' }, 503);
  }
  try {
    const body = await requestObject(request, [
      'expected_content_revision', 'candidate_base64', 'candidate_token', 'fact_pack_hash',
      'confirmed_context_evidence_ids', 'operator_exclusions', 'operator_overrides',
      'schema', 'operator_confirmed',
    ]);
    if (body.operator_confirmed !== true) throw new MainImageHttpError(400, 'operator_confirmation_required');
    const revision = expectedRevision(body);
    const token = asString(body.candidate_token);
    const factPackHash = asString(body.fact_pack_hash);
    if (!token || !factPackHash) throw new MainImageHttpError(400, 'invalid_candidate_reference');
    const confirmed = stringList(body.confirmed_context_evidence_ids ?? [], 'confirmed_context_evidence_ids');
    const exclusions = stringList(body.operator_exclusions ?? [], 'operator_exclusions');
    const overrides = operatorOverrides(body.operator_overrides);
    const schema = requireObject(body.schema) as unknown as MainImageSchema;
    const loaded = await loadMainImageContext(env, listingId, fetchFn);
    if (loaded.context.listing.contentRevision !== revision) throw new MainImageHttpError(409, 'stale_revision');
    if (loaded.factPackHash !== factPackHash) throw new MainImageHttpError(409, 'stale_fact_pack');
    const validation = validateMainImageSchema(schema, loaded.factPack, confirmed);
    if (!validation.valid) throw new MainImageHttpError(400, 'schema_validation_failed', validation);

    const verified = await verifyCandidateToken(token, env.MAIN_IMAGE_CANDIDATE_SIGNING_SECRET);
    if (!verified.ok) throw new MainImageHttpError(400, `invalid_candidate_token_${verified.error}`);
    const candidateBytes = base64ToBytes(body.candidate_base64);
    const imageValidation = validateMainImageBytes(candidateBytes, { expectedContentType: 'image/jpeg' });
    if (!imageValidation.valid) throw new MainImageHttpError(400, 'invalid_candidate_image', imageValidation.errors);
    const imageSha256 = await hashBytes(candidateBytes);
    const schemaHash = await hashCanonicalJson(schema);
    const payload = verified.payload;
    if (payload.listingId !== listingId || payload.contentRevision !== revision
      || payload.factPackHash !== factPackHash || payload.schemaHash !== schemaHash
      || payload.imageSha256 !== imageSha256 || payload.model !== (env.OPENAI_IMAGE_MODEL || 'gpt-image-2')) {
      throw new MainImageHttpError(409, 'candidate_binding_mismatch');
    }

    const itemCode = asString(loaded.selectedVariant.item_code);
    if (!itemCode) throw new MainImageHttpError(409, 'missing_item_code');
    const assetId = crypto.randomUUID();
    const safeItemCode = itemCode.replace(/[^A-Za-z0-9._-]/g, '_');
    const key = `products/${safeItemCode}/main-images/${assetId}/v1.jpg`;
    if (await env.MAIN_IMAGE_ASSETS.head(key)) throw new MainImageHttpError(409, 'asset_key_conflict');
    const assetUrl = publicAssetUrl(env.MAIN_IMAGE_ASSET_PUBLIC_BASE_URL, key);
    await env.MAIN_IMAGE_ASSETS.put(key, candidateBytes, {
      httpMetadata: { contentType: 'image/jpeg' },
      customMetadata: { sha256: imageSha256, listing_id: listingId },
    });
    let assetInserted = false;
    try {
      const rows = await postgrestInsert(env, 'product_assets', [{
        id: assetId,
        product_family_id: loaded.listing.product_family_id ?? null,
        product_spu_id: loaded.context.listing.productSpuId,
        variant_id: loaded.context.listing.selectedVariantId,
        asset_type: 'image',
        asset_url: assetUrl,
        asset_path: key,
        position: 1,
        source_system: 'rpagentos_main_image',
        alt_text: loaded.context.listing.title,
        metadata: {
          width: imageValidation.info.width,
          height: imageValidation.info.height,
          content_type: imageValidation.info.contentType,
          byte_size: candidateBytes.length,
          checksum_sha256: imageSha256,
          main_image: {
            listing_id: listingId,
            source_hash: factPackHash,
            fact_pack_hash: factPackHash,
            fact_pack: loaded.factPack,
            confirmed_context_evidence_ids: confirmed,
            operator_exclusions: exclusions,
            operator_overrides: overrides,
            schema,
            schema_hash: schemaHash,
            prompt_version: SCHEMA_PROMPT_VERSION,
            schema_model: env.OPENAI_SCHEMA_MODEL || 'gpt-5.4',
            image_model: payload.model,
          },
        },
      }], fetchFn);
      if (rows.length !== 1) throw new Error('asset_insert_missing');
      assetInserted = true;
      await postgrestInsert(env, 'platform_listing_events', [{
        listing_id: listingId,
        from_stage: asString(loaded.listing.lifecycle_stage) ?? 'draft',
        to_stage: asString(loaded.listing.lifecycle_stage) ?? 'draft',
        content_revision: revision,
        event_type: 'main_image_asset_saved',
        actor: 'operator',
        metadata: { asset_id: assetId, object_key: key, checksum_sha256: imageSha256 },
      }], fetchFn);
    } catch (error) {
      let canDeleteObject = !assetInserted;
      if (assetInserted) {
        try {
          await postgrestDelete(env, 'product_assets', { id: `eq.${assetId}` }, fetchFn);
          canDeleteObject = true;
        } catch {
          canDeleteObject = false;
        }
      }
      if (canDeleteObject) await env.MAIN_IMAGE_ASSETS.delete(key).catch(() => undefined);
      throw error;
    }
    return json({
      asset_id: assetId,
      object_key: key,
      asset_url: assetUrl,
      checksum_sha256: imageSha256,
      width: imageValidation.info.width,
      height: imageValidation.info.height,
      outcome: 'saved',
    }, 201);
  } catch (error) { return responseForError(error); }
}

function replaceMainImage(first: string, existing: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const url of [first, ...existing.slice(1)]) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    result.push(url);
  }
  return result;
}

function exactStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) return null;
  return value as string[];
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

async function releaseImageClaim(
  env: InternalCatalogEnv,
  listingId: string,
  claimId: string,
  stageBefore: string,
  fetchFn: FetchLike,
): Promise<void> {
  await postgrestPatch(env, 'platform_listings', {
    id: `eq.${listingId}`, publish_claim_id: `eq.${claimId}`, lifecycle_stage: 'eq.publish_pending',
  }, {
    lifecycle_stage: stageBefore,
    publish_claim_id: null,
    publish_claimed_at: null,
    publish_idempotency_key: null,
  }, fetchFn).catch(() => null);
}

export async function handleOperatorMainImagePublish(
  request: Request,
  env: InternalCatalogEnv,
  listingId: string,
  fetchFn: FetchLike = fetch,
): Promise<Response> {
  const early = ensureHandlerBase(request, env, listingId, 'POST');
  if (early) return early;
  if (!env.CATALOGSYNC_RELAY_URL || !env.CATALOGSYNC_RELAY_SECRET) {
    return json({ error: 'publisher_not_configured' }, 503);
  }
  try {
    const body = await requestObject(request, [
      'expected_content_revision', 'asset_id', 'idempotency_key', 'operator_confirmed',
    ]);
    if (body.operator_confirmed !== true) throw new MainImageHttpError(400, 'operator_confirmation_required');
    const revision = expectedRevision(body);
    const assetId = asString(body.asset_id);
    const idempotencyKey = asString(body.idempotency_key);
    if (!assetId || !UUID_RE.test(assetId)) throw new MainImageHttpError(400, 'invalid_asset_id');
    if (!idempotencyKey || idempotencyKey.length > 256) throw new MainImageHttpError(400, 'invalid_idempotency_key');
    const loaded = await loadMainImageContext(env, listingId, fetchFn);
    const currentRevision = loaded.context.listing.contentRevision;
    if (loaded.listing.publish_idempotency_key === idempotencyKey && !loaded.listing.publish_claim_id) {
      return json({ listing_id: listingId, content_revision: currentRevision, outcome: 'replay' });
    }
    if (currentRevision !== revision || loaded.listing.publish_claim_id) {
      throw new MainImageHttpError(409, 'stale_revision');
    }
    if (loaded.listing.lifecycle_stage === 'retired') throw new MainImageHttpError(409, 'listing_not_eligible');
    const assetRows = await supabaseRows(supabaseEnv(env), 'product_assets', {
      select: 'id,product_spu_id,variant_id,asset_type,asset_url,asset_path,metadata,source_system',
      id: `eq.${assetId}`,
      limit: '2',
    }, fetchFn) as Record<string, unknown>[];
    if (assetRows.length !== 1) throw new MainImageHttpError(404, 'asset_not_found');
    const asset = assetRows[0];
    const mainImageMeta = metadataRecord(metadataRecord(asset.metadata).main_image);
    if (asset.asset_type !== 'image' || asset.source_system !== 'rpagentos_main_image'
      || mainImageMeta.listing_id !== listingId
      || asString(asset.product_spu_id) !== loaded.context.listing.productSpuId
      || asString(asset.variant_id) !== loaded.context.listing.selectedVariantId) {
      throw new MainImageHttpError(409, 'asset_listing_mismatch');
    }
    const assetUrl = asString(asset.asset_url);
    if (!assetUrl || !safeSourceUrl(assetUrl)) throw new MainImageHttpError(409, 'asset_url_invalid');
    const previousOrder = loaded.context.listing.imageUrls;
    const newOrder = replaceMainImage(assetUrl, previousOrder);
    const claimId = crypto.randomUUID();
    const stageBefore = asString(loaded.listing.lifecycle_stage) ?? 'draft';
    const claimed = await postgrestPatch(env, 'platform_listings', {
      id: `eq.${listingId}`,
      content_revision: `eq.${revision}`,
      publish_claim_id: 'is.null',
      lifecycle_stage: 'neq.retired',
    }, {
      lifecycle_stage: 'publish_pending',
      publish_claim_id: claimId,
      publish_idempotency_key: idempotencyKey,
      publish_claimed_at: new Date().toISOString(),
    }, fetchFn);
    if (!claimed) throw new MainImageHttpError(409, 'stale_revision');

    try {
      await postgrestInsert(env, 'platform_listing_events', [{
        listing_id: listingId,
        from_stage: stageBefore,
        to_stage: 'publish_pending',
        content_revision: revision,
        event_type: 'main_image_publish_requested',
        actor: 'operator',
        idempotency_key: idempotencyKey,
        metadata: { asset_id: assetId, previous_image_order: previousOrder, requested_image_order: newOrder },
      }], fetchFn);
    } catch (error) {
      await releaseImageClaim(env, listingId, claimId, stageBefore, fetchFn);
      throw error;
    }

    let relay: Record<string, unknown>;
    try {
      const relayResponse = await fetchFn(`${env.CATALOGSYNC_RELAY_URL.replace(/\/$/, '')}/marketplace/mercari`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-relay-secret': env.CATALOGSYNC_RELAY_SECRET },
        body: JSON.stringify({
          action: 'listing-image-update',
          dryRun: false,
          payload: {
            shopCode: loaded.context.listing.shopCode,
            listingId: loaded.context.listing.externalListingId,
            imageUrls: newOrder,
          },
        }),
      });
      relay = await relayResponse.json() as Record<string, unknown>;
      const observed = metadataRecord(relay.observed);
      const observedImages = exactStringArray(observed.images);
      if (!relayResponse.ok || relay.ok !== true
        || observed.shopCode !== loaded.context.listing.shopCode
        || observed.listingId !== loaded.context.listing.externalListingId
        || !observedImages || !arraysEqual(observedImages, newOrder)) {
        throw new Error('relay_readback_mismatch');
      }
    } catch {
      await releaseImageClaim(env, listingId, claimId, stageBefore, fetchFn);
      await postgrestInsert(env, 'platform_listing_events', [{
        listing_id: listingId,
        from_stage: 'publish_pending',
        to_stage: stageBefore,
        content_revision: revision,
        event_type: 'main_image_publish_failed',
        actor: 'system',
        idempotency_key: idempotencyKey,
        metadata: { asset_id: assetId, previous_image_order: previousOrder },
      }], fetchFn).catch(() => []);
      return json({ listing_id: listingId, content_revision: revision, outcome: 'publish_failed' }, 502);
    }

    const nextRevision = revision + 1;
    const now = new Date().toISOString();
    const imageRows = newOrder.map((url, index) => ({
      listing_id: listingId,
      image_position: index + 1,
      image_url: url,
      image_type: index === 0 ? 'main' : 'gallery',
      source: index === 0 ? 'rpagentos_main_image' : 'marketplace_preserved',
      content_revision: nextRevision,
    }));
    try {
      await postgrestInsert(env, 'platform_listing_images', imageRows, fetchFn, 'listing_id,image_position');
      await postgrestDelete(env, 'platform_listing_images', {
        listing_id: `eq.${listingId}`, image_position: `gt.${newOrder.length}`,
      }, fetchFn);
      const finalized = await postgrestPatch(env, 'platform_listings', {
        id: `eq.${listingId}`,
        content_revision: `eq.${revision}`,
        publish_claim_id: `eq.${claimId}`,
        lifecycle_stage: 'eq.publish_pending',
      }, {
        images: newOrder,
        observed_images: newOrder,
        observed_at: now,
        platform_updated_at: now,
        lifecycle_stage: 'published',
        content_revision: nextRevision,
        content_origin: 'operator',
        published_content_revision: nextRevision,
        published_at: loaded.listing.published_at ?? now,
        content_drift: false,
        score_total: null,
        score_modules: null,
        scored_content_revision: null,
        scored_at: null,
        score_config_version: null,
        score_config_hash: null,
        publish_claim_id: null,
        publish_claimed_at: null,
      }, fetchFn);
      if (!finalized) throw new Error('finalize_conflict');
      await postgrestInsert(env, 'platform_listing_events', [{
        listing_id: listingId,
        from_stage: stageBefore,
        to_stage: 'published',
        content_revision: nextRevision,
        event_type: 'main_image_published',
        actor: 'operator',
        idempotency_key: idempotencyKey,
        metadata: { asset_id: assetId, previous_image_order: previousOrder, new_image_order: newOrder },
      }], fetchFn);
    } catch {
      return json({ error: 'external_publish_requires_reconciliation' }, 502);
    }
    return json({
      listing_id: listingId,
      content_revision: nextRevision,
      asset_id: assetId,
      image_urls: newOrder,
      previous_image_urls: previousOrder,
      outcome: 'published',
    });
  } catch (error) { return responseForError(error); }
}
