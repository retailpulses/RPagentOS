export interface InternalCatalogEnv {
  INTERNAL_CATALOG_API_TOKEN?: string;
  CATALOGSYNC_PIPELINE_API_TOKEN?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

export interface CatalogSkuResponse {
  item_code: string;
  source_available_qty: number | null;
  sync_status: string | null;
  last_sync_success_at: string | null;
}

export interface CatalogInventoryQueryResponse {
  results: Array<
    | (CatalogSkuResponse & { requested_item_code: string })
    | {
      requested_item_code: string;
      item_code: string | null;
      error:
      | 'sku_not_found'
      | 'duplicate_item_code'
      | 'commercial_state_missing'
      | 'duplicate_commercial_state'
      | 'source_quantity_unknown'
      | 'sync_not_ready';
    }
  >;
}

export interface ListingStateUpdate {
  platform: string;
  shop_code: string;
  item_code: string;
  external_listing_id: string;
  external_sku_id: string;
  sku_code: string;
  listing_status: 'UNOPENED' | 'OPENED' | 'CLOSED' | 'SUSPENDED';
  observed_at: string;
  idempotency_key: string;
  metadata?: Record<string, unknown>;
}

export type ListingStateResultRow =
  | {
      platform: string;
      shop_code: string;
      external_listing_id: string;
      result: 'created' | 'updated' | 'unchanged';
    }
  | {
      platform: string;
      shop_code: string;
      external_listing_id: string;
      error: 'variant_not_found' | 'duplicate_item_code' | 'identity_conflict' | 'illegal_status_transition';
    };

export interface ListingStateBatchResponse {
  results: ListingStateResultRow[];
}

export interface SourceImportRunRequest {
  source_system: string;
  window_start: string;
  window_end: string;
  run_key: string;
  is_bootstrap: boolean;
}

export interface SourceImportRowRequest {
  row_index: number;
  item_code: string;
  source_added_at: string;
  source_updated_at: string | null;
  row_hash: string;
  variant: {
    variant_name: string;
    color: string | null;
    material: string | null;
    raw_payload: Record<string, unknown>;
  };
  commercial: {
    source_available_qty: number;
    owned_qty: number;
    source_unit_price: number;
    discounted_unit_price: number | null;
    fulfillment_fee: number;
    effective_cost_price: number;
    inventory_status: string;
    restock_date: string | null;
    raw_payload: Record<string, unknown>;
  };
}

export interface SourceImportBatchRequest {
  run: SourceImportRunRequest;
  rows: SourceImportRowRequest[];
}

export type SourceImportResultRow =
  | {
      row_index: number;
      item_code: string;
      variant_id: string;
      result: 'created' | 'updated' | 'unchanged';
    }
  | {
      row_index: number;
      item_code: string;
      error: 'variant_not_found' | 'duplicate_item_code' | 'commercial_state_missing';
    };

export interface SourceImportBatchResponse {
  results: SourceImportResultRow[];
}

export interface ListingCandidatesRequest {
  item_codes: string[];
}

export interface MercariMapping {
  shop_code: string;
  external_listing_id: string;
  external_sku_id: string | null;
  sku_code: string | null;
  status: string | null;
  queued_at: string | null;
  opened_at: string | null;
  // ── v2.0 lifecycle fields ──
  listing_id?: string;
  lifecycle_stage?: string;
  content_revision?: number;
  content_origin?: string;
  title?: string | null;
  description?: string | null;
  images?: unknown[] | null;
  score_total?: number | null;
  score_modules?: Record<string, unknown> | null;
  scored_content_revision?: number | null;
  scored_at?: string | null;
  score_config_version?: string | null;
  score_config_hash?: string | null;
  enhancement_key?: string | null;
  enhancement_model?: string | null;
  published_content_revision?: number | null;
  published_at?: string | null;
}

export type ListingCandidateResult =
  | {
      variant_id: string;
      item_code: string;
      variant_name: string | null;
      color: string | null;
      material: string | null;
      variant_raw_payload: Record<string, unknown> | null;
      commercial_raw_payload: Record<string, unknown> | null;
      source_available_qty: number | null;
      owned_qty: number | null;
      source_unit_price: number | null;
      discounted_unit_price: number | null;
      fulfillment_fee: number | null;
      effective_cost_price: number | null;
      effective_tcogs: number | null;
      mercari_effective_price_excl_shipping: number | null;
      mercari_effective_price_incl_shipping: number | null;
      inventory_status: string | null;
      restock_date: string | null;
      sync_status: string | null;
      last_sync_success_at: string | null;
      mercari_mappings: Record<string, MercariMapping | null>;
    }
  | {
      item_code: string;
      error: 'sku_not_found' | 'duplicate_item_code' | 'commercial_state_missing' | 'listing_mapping_conflict';
    };

export interface ListingCandidatesResponse {
  results: ListingCandidateResult[];
}

// ── v2.0 Lifecycle Contracts ───────────────────────────────────────────

export type LifecycleStage = 'draft' | 'enhanced' | 'publish_pending' | 'published' | 'retired';

export interface CanonicalListingContent {
  listing_id: string;
  shop_code: string;
  lifecycle_stage: LifecycleStage;
  content_revision: number;
  content_origin: 'giga_generated' | 'ai_enhanced' | 'operator';
  title: string | null;
  description: string | null;
  images: unknown[] | null;
  category_id: string | null;
  score_total: number | null;
  score_modules: Record<string, unknown> | null;
  scored_content_revision: number | null;
  scored_at: string | null;
  external_listing_id: string | null;
  external_sku_id: string | null;
  listing_status: string | null;
  enhancement_key: string | null;
  enhancement_model: string | null;
  published_content_revision: number | null;
  published_at: string | null;
}

export interface DraftMaterializationRequest {
  source_variant_ids: string[];
  platform: string;
  shops: string[];
  source_content_hash: string;
  initial_title: string;
  initial_description: string;
  initial_category_id: string;
  initial_images: string[];
}

export interface DraftMaterializationResultRow {
  listing_id: string;
  shop_code: string;
  item_code: string;
  lifecycle_stage: LifecycleStage;
  content_revision: number;
  outcome: 'created' | 'unchanged' | 'protected';
}

export interface DraftMaterializationResponse {
  results: DraftMaterializationResultRow[];
}

export interface ListingContentUpdateRequest {
  expected_content_revision: number;
  title?: string;
  description?: string;
  images?: string[];
  content_origin: 'ai_enhanced' | 'operator';
  enhancement_key?: string;
  enhancement_model?: string;
  enhancement_prompt_version?: string;
  idempotency_key: string;
}

export interface ListingContentUpdateResponse {
  listing_id: string;
  content_revision: number;
  lifecycle_stage: LifecycleStage;
  outcome: 'updated' | 'replay' | 'stale_revision';
}

export interface ListingScoreEntry {
  listing_id: string;
  expected_content_revision: number;
  total: number;
  modules: Record<string, { score: number; max_score: number; reason: string }>;
  config_version: string;
  config_hash: string;
}

export interface ListingScoreResultRow {
  listing_id: string;
  outcome: 'written' | 'stale_revision' | 'not_found';
}

export interface ListingScoresBatchResponse {
  results: ListingScoreResultRow[];
}

export interface PublishClaimRequest {
  expected_content_revision: number;
  score_total: number;
  config_hash: string;
  idempotency_key: string;
}

export interface PublishClaimResult {
  listing_id: string;
  claim_id: string;
  content_revision: number;
  stage_before: LifecycleStage;
  outcome: 'claimed' | 'replay' | 'stale' | 'not_eligible';
}

export interface PublishFinalizationRequest {
  claim_id: string;
  external_listing_id: string;
  external_sku_id: string;
  sku_code: string;
  listing_status: string;
  observed_title: string;
  observed_description: string;
  observed_images: unknown[];
  observed_at: string;
}

export interface PublishFinalizationResult {
  listing_id: string;
  outcome: 'finalized' | 'replay' | 'claim_not_found' | 'identity_conflict';
}

export interface PublishReleaseRequest {
  claim_id: string;
  reason: string;
}

export interface PublishReleaseResult {
  listing_id: string;
  outcome: 'released' | 'claim_not_found' | 'not_pending';
}

export interface RetireListingRequest {
  expected_content_revision: number;
  reason: string;
}

export interface ListingLifecycleResult {
  listing_id: string;
  lifecycle_stage: LifecycleStage;
  outcome: 'transitioned' | 'stale' | 'not_found';
}

export interface ListingObservationEntry {
  listing_id: string;
  external_listing_id: string;
  external_sku_id: string | null;
  listing_status: string;
  observed_title: string | null;
  observed_description: string | null;
  observed_images: unknown[] | null;
  observed_at: string;
}

export interface ListingObservationResultRow {
  listing_id: string;
  outcome: 'observed' | 'not_found';
  content_drift: boolean;
}

export interface ListingObservationsResponse {
  results: ListingObservationResultRow[];
}

export interface ListingsStageQueryResponse {
  listings: CanonicalListingContent[];
  next_cursor: string | null;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const JSON_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

export function tokensEqual(actual: string, expected: string): boolean {
  const length = Math.max(actual.length, expected.length);
  let mismatch = actual.length ^ expected.length;

  for (let index = 0; index < length; index += 1) {
    mismatch |= (actual.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  }

  return mismatch === 0;
}

export function bearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length).trim();
  return token || null;
}

function configurationReady(
  env: InternalCatalogEnv,
): env is InternalCatalogEnv & Required<InternalCatalogEnv> {
  return Boolean(env.INTERNAL_CATALOG_API_TOKEN && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

function authorized(request: Request, expectedToken: string): boolean {
  const token = bearerToken(request);
  return Boolean(token && tokensEqual(token, expectedToken));
}

export function pipelineConfigurationReady(
  env: InternalCatalogEnv,
): env is InternalCatalogEnv & Required<Pick<InternalCatalogEnv, 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'>> {
  return Boolean(
    env.SUPABASE_URL
    && env.SUPABASE_SERVICE_ROLE_KEY
    && (env.CATALOGSYNC_PIPELINE_API_TOKEN || env.INTERNAL_CATALOG_API_TOKEN),
  );
}

export function pipelineAuthorized(request: Request, env: InternalCatalogEnv): boolean {
  const token = bearerToken(request);
  if (!token) return false;
  return Boolean(
    (env.CATALOGSYNC_PIPELINE_API_TOKEN
      && tokensEqual(token, env.CATALOGSYNC_PIPELINE_API_TOKEN))
    || (env.INTERNAL_CATALOG_API_TOKEN
      && tokensEqual(token, env.INTERNAL_CATALOG_API_TOKEN)),
  );
}

export function postgrestIn(values: string[]): string {
  const quoted = values.map((value) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  return `in.(${quoted.join(',')})`;
}

export function identityKey(value: string): string {
  return value.toUpperCase();
}

export function postgrestExactIlikeOr(values: string[]): string {
  const filters = values.map((value) => {
    const pattern = value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_');
    return `item_code.ilike."${pattern}"`;
  });
  return `(${filters.join(',')})`;
}

export function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    result.push(values.slice(offset, offset + size));
  }
  return result;
}

async function postgrestWrite(
  env: Required<Pick<InternalCatalogEnv, 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'>>,
  path: string,
  body: unknown[],
  fetchFn: FetchLike,
  onConflict?: string,
): Promise<Record<string, unknown>[]> {
  const url = new URL(`/rest/v1/${path}`, env.SUPABASE_URL.replace(/\/$/, ''));
  if (onConflict) url.searchParams.set('on_conflict', onConflict);
  const response = await fetchFn(url, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      accept: 'application/json',
      prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown');
    throw new Error(`Supabase ${path} write failed with HTTP ${response.status}: ${errorText}`);
  }
  const result = await response.json();
  if (!Array.isArray(result)) {
    throw new Error(`Supabase ${path} returned non-array response`);
  }
  return result as Record<string, unknown>[];
}

export async function supabaseRows(
  env: Required<Pick<InternalCatalogEnv, 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'>>,
  path: string,
  params: Record<string, string>,
  fetchFn: FetchLike,
): Promise<unknown[]> {
  const url = new URL(`/rest/v1/${path}`, env.SUPABASE_URL.replace(/\/$/, ''));
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const response = await fetchFn(url, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Supabase ${path} read failed with HTTP ${response.status}`);
  }

  const body: unknown = await response.json();
  if (!Array.isArray(body)) throw new Error(`Supabase ${path} returned a non-array response`);
  return body;
}

/**
 * Read the canonical CatalogSync fields for exactly one item code.
 *
 * Known zero is preserved as 0. Missing commercial data remains null so
 * marketplace consumers can fail closed rather than treating unknown as zero.
 */
export async function handleCatalogSkuRequest(
  request: Request,
  env: InternalCatalogEnv,
  itemCodeParam: string,
  fetchFn: FetchLike = fetch,
): Promise<Response> {
  if (request.method !== 'GET') {
    return json({ error: 'method_not_allowed' }, 405, { allow: 'GET' });
  }

  if (!configurationReady(env)) {
    return json({ error: 'service_not_configured' }, 503);
  }

  if (!authorized(request, env.INTERNAL_CATALOG_API_TOKEN)) {
    return json({ error: 'unauthorized' }, 401);
  }

  const itemCode = itemCodeParam.trim();
  if (!itemCode) return json({ error: 'item_code_required' }, 400);

  const supabaseEnv = {
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
  };

  try {
    const variants = await supabaseRows(
      supabaseEnv,
      'product_variants',
      { select: 'id,item_code', or: postgrestExactIlikeOr([itemCode]), limit: '2' },
      fetchFn,
    );

    if (variants.length === 0) return json({ error: 'sku_not_found', item_code: itemCode }, 404);
    if (variants.length > 1) return json({ error: 'duplicate_item_code', item_code: itemCode }, 409);

    const variant = variants[0] as { id?: unknown; item_code?: unknown };
    if (typeof variant.id !== 'string' || typeof variant.item_code !== 'string') {
      throw new Error('Supabase product_variants response is missing required fields');
    }

    const commercials = await supabaseRows(
      supabaseEnv,
      'product_commercials',
      {
        select: 'source_available_qty,sync_status,last_sync_success_at',
        variant_id: `eq.${variant.id}`,
        limit: '1',
      },
      fetchFn,
    );
    const commercial = (commercials[0] ?? {}) as Record<string, unknown>;

    const result: CatalogSkuResponse = {
      item_code: variant.item_code,
      source_available_qty:
        typeof commercial.source_available_qty === 'number' ? commercial.source_available_qty : null,
      sync_status: typeof commercial.sync_status === 'string' ? commercial.sync_status : null,
      last_sync_success_at:
        typeof commercial.last_sync_success_at === 'string' ? commercial.last_sync_success_at : null,
    };

    return json(result);
  } catch (error) {
    console.error('internal catalog SKU read failed', error);
    return json({ error: 'catalog_upstream_error' }, 502);
  }
}


/**
 * Read inventory source state for a bounded set of marketplace item codes.
 * Only fully synced, non-negative integer quantities are emitted as usable
 * items. Every other per-item state is isolated in errors so callers fail
 * closed and cannot accidentally publish stale or unknown inventory.
 */
export async function handleCatalogInventoryQueryRequest(
  request: Request,
  env: InternalCatalogEnv,
  fetchFn: FetchLike = fetch,
): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
  }

  if (!configurationReady(env)) return json({ error: 'service_not_configured' }, 503);
  if (!authorized(request, env.INTERNAL_CATALOG_API_TOKEN)) {
    return json({ error: 'unauthorized' }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'invalid_request', message: 'body must be a JSON object' }, 400);
  }

  const itemCodesValue = (body as Record<string, unknown>).item_codes;
  if (!Array.isArray(itemCodesValue) || itemCodesValue.length === 0) {
    return json({ error: 'invalid_item_codes', message: 'item_codes must be a non-empty array' }, 400);
  }
  if (itemCodesValue.length > 200) {
    return json({ error: 'too_many_item_codes', max_item_codes: 200 }, 413);
  }

  const requestedItems: Array<{ requestedItemCode: string; identity: string }> = [];
  const seen = new Set<string>();
  for (const value of itemCodesValue) {
    if (typeof value !== 'string' || !value.trim() || value.length > 128) {
      return json(
        { error: 'invalid_item_code', message: 'each item code must be a non-empty string of at most 128 characters' },
        400,
      );
    }
    const requestedItemCode = value.trim();
    const identity = identityKey(requestedItemCode);
    if (seen.has(identity)) {
      return json({ error: 'duplicate_request_item_code', item_code: requestedItemCode }, 400);
    }
    seen.add(identity);
    requestedItems.push({ requestedItemCode, identity });
  }

  const supabaseEnv = {
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
  };

  try {
    const variantRows: unknown[] = [];
    for (const batch of chunks(requestedItems, 50)) {
      variantRows.push(...await supabaseRows(
        supabaseEnv,
        'product_variants',
        {
          select: 'id,item_code',
          or: postgrestExactIlikeOr(batch.map(({ identity }) => identity)),
          limit: '101',
        },
        fetchFn,
      ));
    }
    const variantsByIdentity = new Map<string, Array<{ id: string; item_code: string }>>();

    for (const value of variantRows) {
      const row = value as { id?: unknown; item_code?: unknown };
      if (typeof row.id !== 'string' || typeof row.item_code !== 'string') continue;
      const key = identityKey(row.item_code);
      const matches = variantsByIdentity.get(key) ?? [];
      matches.push({ id: row.id, item_code: row.item_code });
      variantsByIdentity.set(key, matches);
    }

    const unambiguousVariants = requestedItems.flatMap(({ identity }) => {
      const matches = variantsByIdentity.get(identity) ?? [];
      return matches.length === 1 ? matches : [];
    });
    const commercialRows = unambiguousVariants.length === 0
      ? []
      : await supabaseRows(
        supabaseEnv,
        'product_commercials',
        {
          select: 'variant_id,source_available_qty,sync_status,last_sync_success_at',
          variant_id: postgrestIn(unambiguousVariants.map((variant) => variant.id)),
          limit: '200',
        },
        fetchFn,
      );
    const commercialsByVariantId = new Map<string, Array<Record<string, unknown>>>();
    for (const value of commercialRows) {
      const row = value as Record<string, unknown>;
      if (typeof row.variant_id !== 'string') continue;
      const matches = commercialsByVariantId.get(row.variant_id) ?? [];
      matches.push(row);
      commercialsByVariantId.set(row.variant_id, matches);
    }

    const response: CatalogInventoryQueryResponse = { results: [] };
    for (const { requestedItemCode, identity } of requestedItems) {
      const variants = variantsByIdentity.get(identity) ?? [];
      if (variants.length === 0) {
        response.results.push({
          requested_item_code: requestedItemCode,
          item_code: null,
          error: 'sku_not_found',
        });
        continue;
      }
      if (variants.length > 1) {
        response.results.push({
          requested_item_code: requestedItemCode,
          item_code: null,
          error: 'duplicate_item_code',
        });
        continue;
      }

      const canonicalItemCode = variants[0].item_code;
      const commercials = commercialsByVariantId.get(variants[0].id) ?? [];
      if (commercials.length === 0) {
        response.results.push({
          requested_item_code: requestedItemCode,
          item_code: canonicalItemCode,
          error: 'commercial_state_missing',
        });
        continue;
      }
      if (commercials.length > 1) {
        response.results.push({
          requested_item_code: requestedItemCode,
          item_code: canonicalItemCode,
          error: 'duplicate_commercial_state',
        });
        continue;
      }
      const commercial = commercials[0];
      if (
        typeof commercial.source_available_qty !== 'number'
        || !Number.isInteger(commercial.source_available_qty)
        || commercial.source_available_qty < 0
      ) {
        response.results.push({
          requested_item_code: requestedItemCode,
          item_code: canonicalItemCode,
          error: 'source_quantity_unknown',
        });
        continue;
      }
      if (commercial.sync_status !== 'synced' || typeof commercial.last_sync_success_at !== 'string') {
        response.results.push({
          requested_item_code: requestedItemCode,
          item_code: canonicalItemCode,
          error: 'sync_not_ready',
        });
        continue;
      }

      response.results.push({
        requested_item_code: requestedItemCode,
        item_code: canonicalItemCode,
        source_available_qty: commercial.source_available_qty,
        sync_status: commercial.sync_status,
        last_sync_success_at: commercial.last_sync_success_at,
      });
    }

    return json(response);
  } catch (error) {
    console.error('internal catalog inventory query failed', error);
    return json({ error: 'catalog_upstream_error' }, 502);
  }
}

const ALLOWED_LISTING_STATE_KEYS = new Set([
  'platform', 'shop_code', 'item_code', 'external_listing_id',
  'external_sku_id', 'sku_code', 'listing_status', 'observed_at',
  'idempotency_key', 'metadata',
]);

const VALID_LISTING_STATUSES = new Set(['UNOPENED', 'OPENED', 'CLOSED', 'SUSPENDED']);

const VALID_TRANSITIONS: Record<string, Set<string>> = {
  __missing__: new Set(['UNOPENED', 'OPENED', 'CLOSED', 'SUSPENDED']),
  UNOPENED: new Set(['UNOPENED', 'OPENED', 'CLOSED', 'SUSPENDED']),
  OPENED: new Set(['OPENED', 'CLOSED', 'SUSPENDED']),
  CLOSED: new Set(['CLOSED']),
  SUSPENDED: new Set(['SUSPENDED']),
};

const LEGACY_LISTING_STATUS_MAP: Record<string, string> = {
  active: 'OPENED',
  inactive: 'CLOSED',
  draft: 'UNOPENED',
};

function normalizedStoredListingStatus(value: string | null): string {
  if (!value) return '__missing__';
  const upper = value.toUpperCase();
  if (VALID_LISTING_STATUSES.has(upper)) return upper;
  return LEGACY_LISTING_STATUS_MAP[value.toLowerCase()] ?? '__missing__';
}

const MAX_FIELD_LENGTHS: Record<string, number> = {
  platform: 64,
  shop_code: 64,
  item_code: 128,
  external_listing_id: 256,
  external_sku_id: 256,
  sku_code: 128,
  idempotency_key: 256,
};

const METADATA_MAX_BYTES = 16 * 1024;

export function validateIsoTimestamp(value: string): boolean {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && value.includes('T');
}

function validateUpdateFields(update: Record<string, unknown>, index: number): string | null {
  for (const key of Object.keys(update)) {
    if (!ALLOWED_LISTING_STATE_KEYS.has(key)) {
      return `unknown_key_${key}_at_index_${index}`;
    }
  }

  const requiredStrings = [
    'platform', 'shop_code', 'item_code', 'external_listing_id',
    'external_sku_id', 'sku_code', 'listing_status', 'observed_at',
    'idempotency_key',
  ] as const;

  for (const field of requiredStrings) {
    const value = update[field];
    if (typeof value !== 'string' || !value.trim()) {
      return `missing_or_blank_${field}_at_index_${index}`;
    }
    const maxLen = MAX_FIELD_LENGTHS[field];
    if (maxLen !== undefined && (value as string).length > maxLen) {
      return `oversized_${field}_at_index_${index}`;
    }
  }

  const status = (update.listing_status as string).trim().toUpperCase();
  if (!VALID_LISTING_STATUSES.has(status)) {
    return `invalid_listing_status_at_index_${index}`;
  }

  if (!validateIsoTimestamp(update.observed_at as string)) {
    return `invalid_observed_at_at_index_${index}`;
  }

  if ('metadata' in update && update.metadata !== null && update.metadata !== undefined) {
    if (typeof update.metadata !== 'object' || Array.isArray(update.metadata)) {
      return `non_object_metadata_at_index_${index}`;
    }
    const jsonSize = new TextEncoder().encode(JSON.stringify(update.metadata)).length;
    if (jsonSize > METADATA_MAX_BYTES) {
      return `oversized_metadata_at_index_${index}`;
    }
  }

  return null;
}

function listingIdentity(platform: string, shopCode: string, extId: string): string {
  return `${platform.toUpperCase()}|${shopCode.toUpperCase()}|${extId.toUpperCase()}`;
}

export async function handleListingStateBatch(
  request: Request,
  env: InternalCatalogEnv,
  fetchFn: FetchLike = fetch,
): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
  }

  if (!pipelineConfigurationReady(env)) return json({ error: 'service_not_configured' }, 503);
  if (!pipelineAuthorized(request, env)) {
    return json({ error: 'unauthorized' }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'invalid_request', message: 'body must be a JSON object' }, 400);
  }

  const updatesValue = (body as Record<string, unknown>).updates;
  if (!Array.isArray(updatesValue)) {
    return json({ error: 'invalid_updates', message: 'updates must be an array' }, 400);
  }
  if (updatesValue.length < 1 || updatesValue.length > 100) {
    return json({ error: 'invalid_update_count', min: 1, max: 100 }, 400);
  }

  const parsedUpdates: Array<{
    index: number;
    platform: string;
    shop_code: string;
    item_code: string;
    external_listing_id: string;
    external_sku_id: string;
    sku_code: string;
    listing_status: string;
    observed_at: string;
    idempotency_key: string;
    metadata: Record<string, unknown>;
  }> = [];

  const seenIdentities = new Set<string>();

  for (let idx = 0; idx < updatesValue.length; idx += 1) {
    const update = updatesValue[idx];
    if (!update || typeof update !== 'object' || Array.isArray(update)) {
      return json({ error: 'invalid_update_item', message: `item at index ${idx} must be an object` }, 400);
    }

    const validationError = validateUpdateFields(update as Record<string, unknown>, idx);
    if (validationError) {
      return json({ error: validationError }, 400);
    }

    const u = update as Record<string, unknown>;
    const platform = (u.platform as string).trim();
    const shopCode = (u.shop_code as string).trim();
    const extId = (u.external_listing_id as string).trim();

    const identity = listingIdentity(platform, shopCode, extId);
    if (seenIdentities.has(identity)) {
      return json({ error: 'duplicate_request_identity', identity }, 400);
    }
    seenIdentities.add(identity);

    const metadataValue = u.metadata;
    const metadata: Record<string, unknown> = metadataValue && typeof metadataValue === 'object' && !Array.isArray(metadataValue)
      ? metadataValue as Record<string, unknown>
      : {};

    parsedUpdates.push({
      index: idx,
      platform,
      shop_code: shopCode,
      item_code: (u.item_code as string).trim(),
      external_listing_id: extId,
      external_sku_id: (u.external_sku_id as string).trim(),
      sku_code: (u.sku_code as string).trim(),
      listing_status: (u.listing_status as string).trim().toUpperCase(),
      observed_at: (u.observed_at as string).trim(),
      idempotency_key: (u.idempotency_key as string).trim(),
      metadata,
    });
  }

  const supabaseEnv = {
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
  };

  let variantRows: unknown[];
  let listingRows: unknown[];
  let skuRows: unknown[];

  try {
    variantRows = [];
    const uniqueItemCodes = [...new Set(parsedUpdates.map((u) => u.item_code))];
    for (const batch of chunks(uniqueItemCodes, 50)) {
      variantRows.push(...await supabaseRows(
        supabaseEnv,
        'product_variants',
        {
          select: 'id,item_code',
          or: postgrestExactIlikeOr(batch.map((code) => code)),
          limit: '101',
        },
        fetchFn,
      ));
    }
  } catch (error) {
    console.error('listing-state variant lookup failed', error);
    return json({ error: 'catalog_upstream_error' }, 502);
  }

  const variantsByIdentity = new Map<string, Array<{ id: string; item_code: string }>>();
  for (const value of variantRows) {
    const row = value as { id?: unknown; item_code?: unknown };
    if (typeof row.id !== 'string' || typeof row.item_code !== 'string') continue;
    const key = identityKey(row.item_code);
    const matches = variantsByIdentity.get(key) ?? [];
    matches.push({ id: row.id, item_code: row.item_code });
    variantsByIdentity.set(key, matches);
  }

  const platformShopGroups = new Map<string, string[]>();
  for (const update of parsedUpdates) {
    const groupKey = `${update.platform}|${update.shop_code}`;
    const extIds = platformShopGroups.get(groupKey) ?? [];
    extIds.push(update.external_listing_id);
    platformShopGroups.set(groupKey, extIds);
  }

  try {
    listingRows = [];
    for (const [groupKey, extIds] of platformShopGroups.entries()) {
      const [platform, shopCode] = groupKey.split('|');
      const uniqueExtIds = [...new Set(extIds)];
      for (const batch of chunks(uniqueExtIds, 50)) {
        listingRows.push(...await supabaseRows(
          supabaseEnv,
          'platform_listings',
          {
            select: 'id,variant_id,listing_status,raw_payload,external_listing_id,platform,shop_code',
            platform: `eq.${platform}`,
            shop_code: `eq.${shopCode}`,
            external_listing_id: postgrestIn(batch),
            limit: String(batch.length + 1),
          },
          fetchFn,
        ));
      }
    }
  } catch (error) {
    console.error('listing-state listing lookup failed', error);
    return json({ error: 'catalog_upstream_error' }, 502);
  }

  const listingByIdentity = new Map<string, {
    id: string;
    variant_id: string | null;
    listing_status: string | null;
    raw_payload: Record<string, unknown> | null;
  }>();

  for (const value of listingRows) {
    const row = value as Record<string, unknown>;
    if (typeof row.id !== 'string') continue;
    const identity = listingIdentity(
      typeof row.platform === 'string' ? row.platform : '',
      typeof row.shop_code === 'string' ? row.shop_code : '',
      typeof row.external_listing_id === 'string' ? row.external_listing_id : '',
    );
    listingByIdentity.set(identity, {
      id: row.id,
      variant_id: typeof row.variant_id === 'string' ? row.variant_id : null,
      listing_status: typeof row.listing_status === 'string' ? row.listing_status : null,
      raw_payload: row.raw_payload && typeof row.raw_payload === 'object' && !Array.isArray(row.raw_payload)
        ? row.raw_payload as Record<string, unknown> : null,
    });
  }

  const existingListingIds = [...listingByIdentity.values()].map((l) => l.id);
  const listingIdToSkus = new Map<string, Array<{
    external_sku_id: string | null;
    sku_code: string | null;
    raw_payload: Record<string, unknown> | null;
  }>>();

  try {
    skuRows = [];
    for (const batch of chunks(existingListingIds, 50)) {
      skuRows.push(...await supabaseRows(
        supabaseEnv,
        'platform_listing_skus',
        {
          select: 'listing_id,external_sku_id,sku_code,raw_payload',
          listing_id: postgrestIn(batch),
          sku_position: 'eq.1',
          limit: String(batch.length + 1),
        },
        fetchFn,
      ));
    }
  } catch (error) {
    console.error('listing-state SKU lookup failed', error);
    return json({ error: 'catalog_upstream_error' }, 502);
  }

  for (const value of skuRows) {
    const row = value as Record<string, unknown>;
    if (typeof row.listing_id !== 'string') continue;
    const entries = listingIdToSkus.get(row.listing_id) ?? [];
    entries.push({
      external_sku_id: typeof row.external_sku_id === 'string' ? row.external_sku_id : null,
      sku_code: typeof row.sku_code === 'string' ? row.sku_code : null,
      raw_payload: row.raw_payload && typeof row.raw_payload === 'object' && !Array.isArray(row.raw_payload)
        ? row.raw_payload as Record<string, unknown> : null,
    });
    listingIdToSkus.set(row.listing_id, entries);
  }

  const results: ListingStateResultRow[] = parsedUpdates.map(() => ({
    platform: '',
    shop_code: '',
    external_listing_id: '',
    error: 'illegal_status_transition' as const,
  }));

  type UpsertEntry = {
    resultIndex: number;
    platform: string;
    shop_code: string;
    external_listing_id: string;
    variantId: string;
    listingStatus: string;
    externalSkuId: string;
    skuCode: string;
    rawPayloadListing: Record<string, unknown>;
    rawPayloadSku: Record<string, unknown>;
  };

  const toUpsert: UpsertEntry[] = [];
  const identityKeyByResultIndex = new Map<number, string>();

  for (const update of parsedUpdates) {
    const identityVal = listingIdentity(update.platform, update.shop_code, update.external_listing_id);
    identityKeyByResultIndex.set(update.index, identityVal);
    results[update.index] = {
      platform: update.platform,
      shop_code: update.shop_code,
      external_listing_id: update.external_listing_id,
      error: 'illegal_status_transition',
    };

    const varMatches = variantsByIdentity.get(identityKey(update.item_code)) ?? [];
    if (varMatches.length === 0) {
      results[update.index] = {
        platform: update.platform,
        shop_code: update.shop_code,
        external_listing_id: update.external_listing_id,
        error: 'variant_not_found',
      };
      continue;
    }
    if (varMatches.length > 1) {
      results[update.index] = {
        platform: update.platform,
        shop_code: update.shop_code,
        external_listing_id: update.external_listing_id,
        error: 'duplicate_item_code',
      };
      continue;
    }

    const variantId = varMatches[0].id;
    const existingListing = listingByIdentity.get(identityVal);

    if (existingListing) {
      if (existingListing.variant_id && existingListing.variant_id !== variantId) {
        results[update.index] = {
          platform: update.platform,
          shop_code: update.shop_code,
          external_listing_id: update.external_listing_id,
          error: 'identity_conflict',
        };
        continue;
      }

      const existingSkus = listingIdToSkus.get(existingListing.id) ?? [];
      const existingSku = existingSkus.length >= 1 ? existingSkus[0] : null;
      if (existingSku) {
        const skuCodeConflict = typeof existingSku.sku_code === 'string'
          && existingSku.sku_code.toUpperCase() !== update.sku_code.toUpperCase();
        const extSkuIdConflict = typeof existingSku.external_sku_id === 'string'
          && existingSku.external_sku_id.toUpperCase() !== update.external_sku_id.toUpperCase();
        if (skuCodeConflict || extSkuIdConflict) {
          results[update.index] = {
            platform: update.platform,
            shop_code: update.shop_code,
            external_listing_id: update.external_listing_id,
            error: 'identity_conflict',
          };
          continue;
        }
      }

      const currentStatus = normalizedStoredListingStatus(existingListing.listing_status);
      const allowed = VALID_TRANSITIONS[currentStatus] ?? new Set();
      if (!allowed.has(update.listing_status)) {
        results[update.index] = {
          platform: update.platform,
          shop_code: update.shop_code,
          external_listing_id: update.external_listing_id,
          error: 'illegal_status_transition',
        };
        continue;
      }

      const storedPayload = existingListing.raw_payload ?? {};
      const storedState = storedPayload.catalogsync_listing_state
        && typeof storedPayload.catalogsync_listing_state === 'object'
        && !Array.isArray(storedPayload.catalogsync_listing_state)
        ? storedPayload.catalogsync_listing_state as Record<string, unknown>
        : {};

      if (
        typeof storedState.idempotency_key === 'string'
        && storedState.idempotency_key === update.idempotency_key
      ) {
        results[update.index] = {
          platform: update.platform,
          shop_code: update.shop_code,
          external_listing_id: update.external_listing_id,
          result: 'unchanged',
        };
        continue;
      }
    } else {
      if (!(VALID_TRANSITIONS.__missing__?.has(update.listing_status))) {
        results[update.index] = {
          platform: update.platform,
          shop_code: update.shop_code,
          external_listing_id: update.external_listing_id,
          error: 'illegal_status_transition',
        };
        continue;
      }
    }

    const existingPayload = existingListing?.raw_payload ?? {};
    const existingState = existingPayload.catalogsync_listing_state
      && typeof existingPayload.catalogsync_listing_state === 'object'
      && !Array.isArray(existingPayload.catalogsync_listing_state)
      ? existingPayload.catalogsync_listing_state as Record<string, unknown>
      : {};

    const catalogsyncState: Record<string, unknown> = {
      ...update.metadata,
      observed_at: update.observed_at,
      idempotency_key: update.idempotency_key,
    };

    if (update.listing_status === 'UNOPENED') {
      catalogsyncState.queued_at = existingState.queued_at ?? update.observed_at;
    } else if (typeof existingState.queued_at === 'string') {
      catalogsyncState.queued_at = existingState.queued_at;
    }

    if (update.listing_status === 'OPENED') {
      catalogsyncState.opened_at = existingState.opened_at ?? update.observed_at;
    } else if (typeof existingState.opened_at === 'string') {
      catalogsyncState.opened_at = existingState.opened_at;
    }

    const mergedListingPayload: Record<string, unknown> = {};
    for (const key of Object.keys(existingPayload)) {
      if (key !== 'catalogsync_listing_state') {
        mergedListingPayload[key] = existingPayload[key];
      }
    }
    mergedListingPayload.catalogsync_listing_state = catalogsyncState;

    const existingSkus = existingListing ? (listingIdToSkus.get(existingListing.id) ?? []) : [];
    const existingSku = existingSkus.length >= 1 ? existingSkus[0] : null;
    const existingSkuPayload = existingSku?.raw_payload ?? {};
    const existingSkuState = existingSkuPayload.catalogsync_listing_state
      && typeof existingSkuPayload.catalogsync_listing_state === 'object'
      && !Array.isArray(existingSkuPayload.catalogsync_listing_state)
      ? existingSkuPayload.catalogsync_listing_state as Record<string, unknown>
      : {};

    const skuCatalogsyncState: Record<string, unknown> = { ...catalogsyncState };
    if (typeof existingSkuState.queued_at === 'string') {
      skuCatalogsyncState.queued_at = existingSkuState.queued_at;
    }
    if (typeof existingSkuState.opened_at === 'string') {
      skuCatalogsyncState.opened_at = existingSkuState.opened_at;
    }

    const mergedSkuPayload: Record<string, unknown> = {};
    for (const key of Object.keys(existingSkuPayload)) {
      if (key !== 'catalogsync_listing_state') {
        mergedSkuPayload[key] = existingSkuPayload[key];
      }
    }
    mergedSkuPayload.catalogsync_listing_state = skuCatalogsyncState;

    toUpsert.push({
      resultIndex: update.index,
      platform: update.platform,
      shop_code: update.shop_code,
      external_listing_id: update.external_listing_id,
      variantId,
      listingStatus: update.listing_status,
      externalSkuId: update.external_sku_id,
      skuCode: update.sku_code,
      rawPayloadListing: mergedListingPayload,
      rawPayloadSku: mergedSkuPayload,
    });
  }

  if (toUpsert.length > 0) {
    const listingBody = toUpsert.map((entry) => ({
      platform: entry.platform,
      shop_code: entry.shop_code,
      external_listing_id: entry.external_listing_id,
      variant_id: entry.variantId,
      listing_status: entry.listingStatus,
      platform_updated_at: entry.rawPayloadListing.catalogsync_listing_state
        ? (entry.rawPayloadListing.catalogsync_listing_state as Record<string, unknown>).observed_at
        : undefined,
      raw_payload: entry.rawPayloadListing,
    }));

    let upsertedListings: Record<string, unknown>[];
    try {
      upsertedListings = await postgrestWrite(
        supabaseEnv,
        'platform_listings',
        listingBody,
        fetchFn,
        'platform,shop_code,external_listing_id',
      );
    } catch (error) {
      console.error('listing-state listing upsert failed', error);
      return json({ error: 'catalog_upstream_error' }, 502);
    }

    const upsertedByIdentity = new Map<string, Record<string, unknown>>();
    for (const listing of upsertedListings) {
      if (
        typeof listing.id !== 'string'
        || typeof listing.platform !== 'string'
        || typeof listing.shop_code !== 'string'
        || typeof listing.external_listing_id !== 'string'
      ) continue;
      upsertedByIdentity.set(
        listingIdentity(listing.platform, listing.shop_code, listing.external_listing_id),
        listing,
      );
    }

    try {
      const skuBody = toUpsert.map((entry) => {
        const listing = upsertedByIdentity.get(
          listingIdentity(entry.platform, entry.shop_code, entry.external_listing_id),
        );
        const listingId = listing?.id as string | undefined;
        if (!listingId) {
          throw new Error(`Supabase platform_listings omitted upserted identity ${entry.external_listing_id}`);
        }

        return {
          listing_id: listingId,
          sku_position: 1,
          variant_id: entry.variantId,
          external_sku_id: entry.externalSkuId,
          sku_code: entry.skuCode,
          seller_sku: entry.skuCode,
          sku_status: entry.listingStatus,
          raw_payload: entry.rawPayloadSku,
        };
      });
      await postgrestWrite(
        supabaseEnv,
        'platform_listing_skus',
        skuBody,
        fetchFn,
        'listing_id,sku_position',
      );
    } catch (error) {
      console.error('listing-state SKU upsert failed', error);
      return json({ error: 'catalog_upstream_error' }, 502);
    }

    for (const entry of toUpsert) {
      const identityVal = listingIdentity(entry.platform, entry.shop_code, entry.external_listing_id);
      const existed = listingByIdentity.has(identityVal);
      results[entry.resultIndex] = {
        platform: entry.platform,
        shop_code: entry.shop_code,
        external_listing_id: entry.external_listing_id,
        result: existed ? 'updated' : 'created',
      };
    }
  }

  const responseBody: ListingStateBatchResponse = { results };
  return json(responseBody);
}

const IMPORT_RAW_MAX_BYTES = 128 * 1024;

const SOURCE_IMPORT_RUN_KEYS = new Set(['source_system', 'window_start', 'window_end', 'run_key', 'is_bootstrap']);

const SOURCE_IMPORT_ROW_KEYS = new Set([
  'row_index', 'item_code', 'source_added_at', 'source_updated_at',
  'row_hash', 'variant', 'commercial',
]);

const SOURCE_IMPORT_VARIANT_KEYS = new Set(['variant_name', 'color', 'material', 'raw_payload']);

const SOURCE_IMPORT_COMMERCIAL_KEYS = new Set([
  'source_available_qty', 'owned_qty', 'source_unit_price', 'discounted_unit_price',
  'fulfillment_fee', 'effective_cost_price', 'inventory_status', 'restock_date', 'raw_payload',
]);

function futureTolerance(): Date {
  return new Date(Date.now() + 3600_000);
}

export async function handleSourceImportBatch(
  request: Request,
  env: InternalCatalogEnv,
  fetchFn: FetchLike = fetch,
): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
  }

  if (!pipelineConfigurationReady(env)) return json({ error: 'service_not_configured' }, 503);
  if (!pipelineAuthorized(request, env)) {
    return json({ error: 'unauthorized' }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'invalid_request', message: 'body must be a JSON object' }, 400);
  }

  const bodyObj = body as Record<string, unknown>;
  const topKeys = Object.keys(bodyObj);
  if (topKeys.length !== 2 || !('run' in bodyObj && 'rows' in bodyObj)
    || topKeys.some((k) => k !== 'run' && k !== 'rows')) {
    return json({ error: 'invalid_request', message: 'body must contain only run and rows' }, 400);
  }

  const runRaw = bodyObj.run;
  if (!runRaw || typeof runRaw !== 'object' || Array.isArray(runRaw)) {
    return json({ error: 'invalid_run', message: 'run must be an object' }, 400);
  }

  const runObj = runRaw as Record<string, unknown>;
  const runExtraKeys = Object.keys(runObj).filter((k) => !SOURCE_IMPORT_RUN_KEYS.has(k));
  if (runExtraKeys.length > 0) {
    return json({ error: 'invalid_run', message: `unknown run keys: ${runExtraKeys.join(', ')}` }, 400);
  }

  if (runObj.source_system !== 'gigab2b_saved') {
    return json({ error: 'invalid_source_system', message: 'source_system must be gigab2b_saved' }, 400);
  }

  if (typeof runObj.window_start !== 'string' || !validateIsoTimestamp(runObj.window_start)) {
    return json({ error: 'invalid_window_start', message: 'window_start must be a valid ISO timestamp' }, 400);
  }
  if (typeof runObj.window_end !== 'string' || !validateIsoTimestamp(runObj.window_end)) {
    return json({ error: 'invalid_window_end', message: 'window_end must be a valid ISO timestamp' }, 400);
  }

  const windowStart = new Date(runObj.window_start);
  const windowEnd = new Date(runObj.window_end);
  if (windowStart.getTime() >= windowEnd.getTime()) {
    return json({ error: 'invalid_window_range', message: 'window_start must be before window_end' }, 400);
  }

  if (typeof runObj.run_key !== 'string' || !/^[a-f0-9]{64}$/i.test(runObj.run_key.trim())) {
    return json({ error: 'invalid_run_key', message: 'run_key must be a 64-character SHA-256 hex digest' }, 400);
  }
  const runKey = runObj.run_key.trim();

  if (typeof runObj.is_bootstrap !== 'boolean') {
    return json({ error: 'invalid_is_bootstrap', message: 'is_bootstrap must be a boolean' }, 400);
  }

  const rowsRaw = bodyObj.rows;
  if (!Array.isArray(rowsRaw) || rowsRaw.length < 1 || rowsRaw.length > 100) {
    return json({ error: 'invalid_rows', message: 'rows must be an array of 1-100 items' }, 400);
  }

  const futureLimit = futureTolerance();

  interface ParsedRow {
    index: number;
    itemCode: string;
    identity: string;
    sourceAddedAt: string;
    sourceUpdatedAt: string | null;
    rowHash: string;
    variantName: string;
    color: string | null;
    material: string | null;
    variantRawPayload: Record<string, unknown>;
    sourceAvailableQty: number;
    ownedQty: number;
    sourceUnitPrice: number;
    discountedUnitPrice: number | null;
    fulfillmentFee: number;
    effectiveCostPrice: number;
    inventoryStatus: string;
    restockDate: string | null;
    commercialRawPayload: Record<string, unknown>;
  }

  const parsedRows: ParsedRow[] = [];
  const seenIndexes = new Set<number>();
  const seenIdentities = new Set<string>();

  for (let idx = 0; idx < rowsRaw.length; idx += 1) {
    const rowVal = rowsRaw[idx];
    if (!rowVal || typeof rowVal !== 'object' || Array.isArray(rowVal)) {
      return json({ error: 'invalid_row_item', message: `item at index ${idx} must be an object` }, 400);
    }
    const rowObj = rowVal as Record<string, unknown>;

    const rowExtraKeys = Object.keys(rowObj).filter((k) => !SOURCE_IMPORT_ROW_KEYS.has(k));
    if (rowExtraKeys.length > 0) {
      return json({ error: 'invalid_row', message: `unknown row keys at input index ${idx}: ${rowExtraKeys.join(', ')}` }, 400);
    }

    const rowJsonSize = new TextEncoder().encode(JSON.stringify(rowVal)).length;
    if (rowJsonSize > IMPORT_RAW_MAX_BYTES) {
      return json({ error: 'oversized_row', message: `row at input index ${idx} exceeds ${IMPORT_RAW_MAX_BYTES} bytes` }, 400);
    }

    if (typeof rowObj.row_index !== 'number' || !Number.isInteger(rowObj.row_index) || rowObj.row_index < 1) {
      return json({ error: 'invalid_row_index', message: `row_index must be a positive integer, got ${rowObj.row_index}` }, 400);
    }
    const rowIndex = rowObj.row_index;
    if (seenIndexes.has(rowIndex)) {
      return json({ error: 'duplicate_row_index', message: `row_index ${rowIndex} appears more than once` }, 400);
    }
    seenIndexes.add(rowIndex);

    if (typeof rowObj.item_code !== 'string' || !rowObj.item_code.trim() || rowObj.item_code.length > 128) {
      return json({ error: 'invalid_item_code', message: `item_code must be a non-empty string <=128 chars` }, 400);
    }
    const itemCode = rowObj.item_code.trim();
    const identity = identityKey(itemCode);
    if (seenIdentities.has(identity)) {
      return json({ error: 'duplicate_item_code', message: `item_code ${itemCode} appears more than once (case-insensitive)` }, 400);
    }
    seenIdentities.add(identity);

    if (typeof rowObj.source_added_at !== 'string' || !validateIsoTimestamp(rowObj.source_added_at)) {
      return json({ error: 'invalid_source_added_at', message: 'source_added_at must be a valid ISO timestamp' }, 400);
    }
    const sourceAddedAt = new Date(rowObj.source_added_at);
    if (sourceAddedAt.getTime() > windowEnd.getTime()) {
      return json({ error: 'leaking_timestamp', message: `source_added_at for row ${rowIndex} exceeds window_end` }, 400);
    }
    if (sourceAddedAt.getTime() > futureLimit.getTime()) {
      return json({ error: 'future_timestamp', message: `source_added_at for row ${rowIndex} is in the future` }, 400);
    }

    let sourceUpdatedAt: string | null = null;
    if (rowObj.source_updated_at !== null && rowObj.source_updated_at !== undefined) {
      if (typeof rowObj.source_updated_at !== 'string' || !validateIsoTimestamp(rowObj.source_updated_at)) {
        return json({ error: 'invalid_source_updated_at', message: 'source_updated_at must be a valid ISO timestamp or null' }, 400);
      }
      const sua = new Date(rowObj.source_updated_at);
      if (sua.getTime() > windowEnd.getTime()) {
        return json({ error: 'leaking_timestamp', message: `source_updated_at for row ${rowIndex} exceeds window_end` }, 400);
      }
      if (sua.getTime() > futureLimit.getTime()) {
        return json({ error: 'future_timestamp', message: `source_updated_at for row ${rowIndex} is in the future` }, 400);
      }
      sourceUpdatedAt = rowObj.source_updated_at;
    }

    if (typeof rowObj.row_hash !== 'string' || !/^[a-f0-9]{64}$/i.test(rowObj.row_hash)) {
      return json({ error: 'invalid_row_hash', message: 'row_hash must be a 64-character SHA-256 hex digest' }, 400);
    }

    const variantRaw = rowObj.variant;
    if (!variantRaw || typeof variantRaw !== 'object' || Array.isArray(variantRaw)) {
      return json({ error: 'invalid_variant', message: 'variant must be an object' }, 400);
    }
    const variantObj = variantRaw as Record<string, unknown>;
    const variantExtraKeys = Object.keys(variantObj).filter((k) => !SOURCE_IMPORT_VARIANT_KEYS.has(k));
    if (variantExtraKeys.length > 0) {
      return json({ error: 'invalid_variant', message: `unknown variant keys: ${variantExtraKeys.join(', ')}` }, 400);
    }
    if (typeof variantObj.variant_name !== 'string' || !variantObj.variant_name.trim()) {
      return json({ error: 'invalid_variant_name', message: 'variant.variant_name must be a non-empty string' }, 400);
    }
    const colorVal = variantObj.color;
    if (colorVal !== null && colorVal !== undefined && typeof colorVal !== 'string') {
      return json({ error: 'invalid_color', message: 'variant.color must be a string or null' }, 400);
    }
    const materialVal = variantObj.material;
    if (materialVal !== null && materialVal !== undefined && typeof materialVal !== 'string') {
      return json({ error: 'invalid_material', message: 'variant.material must be a string or null' }, 400);
    }
    const variantPayload = variantObj.raw_payload;
    if (!variantPayload || typeof variantPayload !== 'object' || Array.isArray(variantPayload)) {
      return json({ error: 'invalid_variant_raw_payload', message: 'variant.raw_payload must be an object' }, 400);
    }

    const commercialRaw = rowObj.commercial;
    if (!commercialRaw || typeof commercialRaw !== 'object' || Array.isArray(commercialRaw)) {
      return json({ error: 'invalid_commercial', message: 'commercial must be an object' }, 400);
    }
    const commercialObj = commercialRaw as Record<string, unknown>;
    const commercialExtraKeys = Object.keys(commercialObj).filter((k) => !SOURCE_IMPORT_COMMERCIAL_KEYS.has(k));
    if (commercialExtraKeys.length > 0) {
      return json({ error: 'invalid_commercial', message: `unknown commercial keys: ${commercialExtraKeys.join(', ')}` }, 400);
    }

    function requireNumber(key: string, integer = false): number {
      const v = commercialObj[key];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || (integer && !Number.isInteger(v))) {
        throw new Error(`commercial.${key} must be a non-negative${integer ? ' integer' : ''}`);
      }
      return v;
    }

    try {
      const commercialDiscounted = commercialObj.discounted_unit_price;
      if (commercialDiscounted !== null && commercialDiscounted !== undefined && (typeof commercialDiscounted !== 'number' || !Number.isFinite(commercialDiscounted) || commercialDiscounted < 0)) {
        throw new Error('commercial.discounted_unit_price must be a non-negative number or null');
      }
      const commercialRestock = commercialObj.restock_date;
      if (commercialRestock !== null && commercialRestock !== undefined
        && (typeof commercialRestock !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(commercialRestock))) {
        throw new Error('commercial.restock_date must be YYYY-MM-DD or null');
      }
      if (typeof commercialObj.inventory_status !== 'string' || !commercialObj.inventory_status.trim()) {
        throw new Error('commercial.inventory_status must be a non-empty string');
      }
      const commercialPayload = commercialObj.raw_payload;
      if (!commercialPayload || typeof commercialPayload !== 'object' || Array.isArray(commercialPayload)) {
        throw new Error('commercial.raw_payload must be an object');
      }

      parsedRows.push({
        index: rowIndex,
        itemCode,
        identity,
        sourceAddedAt: rowObj.source_added_at,
        sourceUpdatedAt,
        rowHash: rowObj.row_hash,
        variantName: variantObj.variant_name.trim(),
        color: typeof colorVal === 'string' ? colorVal.trim() || null : null,
        material: typeof materialVal === 'string' ? materialVal.trim() || null : null,
        variantRawPayload: variantPayload as Record<string, unknown>,
        sourceAvailableQty: requireNumber('source_available_qty', true),
        ownedQty: requireNumber('owned_qty', true),
        sourceUnitPrice: requireNumber('source_unit_price'),
        discountedUnitPrice: typeof commercialDiscounted === 'number' ? commercialDiscounted : null,
        fulfillmentFee: requireNumber('fulfillment_fee'),
        effectiveCostPrice: requireNumber('effective_cost_price'),
        inventoryStatus: (commercialObj.inventory_status as string).trim(),
        restockDate: typeof commercialRestock === 'string' ? commercialRestock : null,
        commercialRawPayload: commercialPayload as Record<string, unknown>,
      });
    } catch (err) {
      return json({ error: 'invalid_commercial_field', message: (err as Error).message }, 400);
    }
  }

  const supabaseEnv = {
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
  };

  const uniqueCodes = [...new Set(parsedRows.map((r) => r.itemCode))];

  let variantRows: unknown[];
  try {
    variantRows = [];
    for (const batch of chunks(uniqueCodes, 50)) {
      variantRows.push(...await supabaseRows(
        supabaseEnv,
        'product_variants',
        { select: 'id,item_code,sku,raw_payload', or: postgrestExactIlikeOr(batch), limit: String(batch.length + 1) },
        fetchFn,
      ));
    }
  } catch (error) {
    console.error('source-import variant read failed', error);
    return json({ error: 'catalog_upstream_error' }, 502);
  }

  const variantByIdentity = new Map<string, {
    id: string;
    item_code: string;
    sku: string;
    raw_payload: Record<string, unknown> | null;
  }>();
  for (const value of variantRows) {
    const row = value as { id?: unknown; item_code?: unknown; sku?: unknown; raw_payload?: unknown };
    if (typeof row.id !== 'string' || typeof row.item_code !== 'string' || typeof row.sku !== 'string') continue;
    const key = identityKey(row.item_code);
    if (!variantByIdentity.has(key)) {
      variantByIdentity.set(key, {
        id: row.id,
        item_code: row.item_code,
        sku: row.sku,
        raw_payload: row.raw_payload && typeof row.raw_payload === 'object' && !Array.isArray(row.raw_payload)
          ? row.raw_payload as Record<string, unknown> : null,
      });
    }
  }

  const changedVariantRows = parsedRows.flatMap((parsed) => {
      const existing = variantByIdentity.get(parsed.identity);
      const existingPayload = existing?.raw_payload ?? {};
      const priorState = existingPayload.catalogsync_source_import;
      if (priorState && typeof priorState === 'object' && !Array.isArray(priorState)
        && (priorState as Record<string, unknown>).row_hash === parsed.rowHash) {
        return [];
      }
      return {
        sku: existing?.sku ?? parsed.itemCode,
        item_code: existing?.item_code ?? parsed.itemCode,
        variant_name: parsed.variantName,
        color: parsed.color,
        material: parsed.material,
        status: 'active',
        raw_payload: {
          ...existingPayload,
          gigab2b_saved: parsed.variantRawPayload,
          catalogsync_source_import: {
            row_hash: parsed.rowHash,
            source_added_at: parsed.sourceAddedAt,
            source_updated_at: parsed.sourceUpdatedAt,
          },
        },
      };
    });

  if (changedVariantRows.length > 0) {
    try {
      await postgrestWrite(supabaseEnv, 'product_variants', changedVariantRows, fetchFn, 'sku');
    } catch (error) {
      console.error('source-import variant create failed', error);
      return json({ error: 'catalog_upstream_error' }, 502);
    }
  }

  let allVariantRows: unknown[];
  try {
    allVariantRows = [];
    for (const batch of chunks(uniqueCodes, 50)) {
      allVariantRows.push(...await supabaseRows(
        supabaseEnv,
        'product_variants',
        { select: 'id,item_code', or: postgrestExactIlikeOr(batch), limit: String(batch.length + 1) },
        fetchFn,
      ));
    }
  } catch (error) {
    console.error('source-import variant re-read failed', error);
    return json({ error: 'catalog_upstream_error' }, 502);
  }

  const resolvedVariants = new Map<string, { id: string; item_code: string }>();
  for (const value of allVariantRows) {
    const row = value as { id?: unknown; item_code?: unknown };
    if (typeof row.id !== 'string' || typeof row.item_code !== 'string') continue;
    const key = identityKey(row.item_code);
    const existing = resolvedVariants.get(key);
    if (existing) {
      return json({ error: 'catalog_upstream_error', message: `ambiguous variant identity for ${row.item_code}` }, 502);
    }
    resolvedVariants.set(key, { id: row.id, item_code: row.item_code });
  }

  for (const code of uniqueCodes) {
    if (!resolvedVariants.has(identityKey(code))) {
      return json({ error: 'catalog_upstream_error', message: `variant still missing for ${code}` }, 502);
    }
  }

  const existingCommercialPayloads = new Map<string, Record<string, unknown>>();
  try {
    const variantIds = [...resolvedVariants.values()].map((variant) => variant.id);
    for (const batch of chunks(variantIds, 50)) {
      const rows = await supabaseRows(
        supabaseEnv,
        'product_commercials',
        { select: 'variant_id,raw_payload', variant_id: postgrestIn(batch), limit: String(batch.length + 1) },
        fetchFn,
      );
      for (const value of rows) {
        const row = value as Record<string, unknown>;
        if (typeof row.variant_id !== 'string') continue;
        existingCommercialPayloads.set(
          row.variant_id,
          row.raw_payload && typeof row.raw_payload === 'object' && !Array.isArray(row.raw_payload)
            ? row.raw_payload as Record<string, unknown> : {},
        );
      }
    }
  } catch (error) {
    console.error('source-import commercial read failed', error);
    return json({ error: 'catalog_upstream_error' }, 502);
  }

  let runId: string;
  try {
    const existingRuns = await supabaseRows(
      supabaseEnv,
      'source_import_runs',
      {
        select: 'id,status,row_count',
        source_system: 'eq.gigab2b_saved',
        file_hash: `eq.${runKey}`,
        limit: '2',
      },
      fetchFn,
    );

    if (existingRuns.length > 1) {
      throw new Error(`duplicate source import run identity for ${runKey}`);
    }
    const existingRun = existingRuns[0] as Record<string, unknown> | undefined;
    if (existingRun && typeof existingRun.id === 'string') {
      runId = existingRun.id;
    } else {
      const sourceFile = `saved:${runObj.window_start}/${runObj.window_end}`;
      const newRunBody = [{
        source_system: 'gigab2b_saved',
        source_file: sourceFile,
        file_hash: runKey,
        status: 'running',
        row_count: 0,
        started_at: new Date().toISOString(),
        metadata: { window_start: runObj.window_start, window_end: runObj.window_end, is_bootstrap: runObj.is_bootstrap },
      }];

      const response = await fetchFn(
        new URL('/rest/v1/source_import_runs', supabaseEnv.SUPABASE_URL.replace(/\/$/, '')),
        {
          method: 'POST',
          headers: {
            apikey: supabaseEnv.SUPABASE_SERVICE_ROLE_KEY,
            authorization: `Bearer ${supabaseEnv.SUPABASE_SERVICE_ROLE_KEY}`,
            'content-type': 'application/json',
            accept: 'application/json',
            prefer: 'return=representation',
          },
          body: JSON.stringify(newRunBody),
        },
      );
      if (!response.ok) {
        const errorText = await response.text().catch(() => 'unknown');
        throw new Error(`run insert failed HTTP ${response.status}: ${errorText}`);
      }
      const inserted = await response.json() as Record<string, unknown>[];
      if (!Array.isArray(inserted) || inserted.length === 0 || typeof inserted[0].id !== 'string') {
        throw new Error('run insert returned no id');
      }
      runId = inserted[0].id;
    }
  } catch (error) {
    console.error('source-import run resolution failed', error);
    return json({ error: 'catalog_upstream_error' }, 502);
  }

  let existingRowHashes: Map<number, string>;
  try {
    const existingRows = await supabaseRows(
      supabaseEnv,
      'source_import_rows',
      {
        select: 'row_index,row_hash',
        run_id: `eq.${runId}`,
        limit: '100',
      },
      fetchFn,
    );
    existingRowHashes = new Map<number, string>();
    for (const value of existingRows) {
      const row = value as { row_index?: unknown; row_hash?: unknown };
      if (typeof row.row_index === 'number' && typeof row.row_hash === 'string') {
        existingRowHashes.set(row.row_index, row.row_hash);
      }
    }
  } catch (error) {
    console.error('source-import existing row read failed', error);
    return json({ error: 'catalog_upstream_error' }, 502);
  }

  const results: SourceImportBatchResponse = { results: [] };

  const rowsToUpsert: Array<{
    run_id: string;
    row_index: number;
    source_key: string;
    row_hash: string;
    raw_row: Record<string, unknown>;
    normalized_status: string;
  }> = [];

  const variantsToResolve = new Map<number, { variantId: string; itemCode: string }>();

  for (const parsed of parsedRows) {
    const storedHash = existingRowHashes.get(parsed.index);
    if (storedHash === parsed.rowHash) {
      const variant = resolvedVariants.get(parsed.identity);
      results.results.push({
        row_index: parsed.index,
        item_code: variant?.item_code ?? parsed.itemCode,
        variant_id: variant?.id ?? '',
        result: 'unchanged',
      });
      continue;
    }

    const variant = resolvedVariants.get(parsed.identity);
    if (!variant) {
      results.results.push({
        row_index: parsed.index,
        item_code: parsed.itemCode,
        error: 'variant_not_found',
      });
      continue;
    }

    variantsToResolve.set(parsed.index, { variantId: variant.id, itemCode: variant.item_code });

    const rawRow = {
      item_code: parsed.itemCode,
      source_added_at: parsed.sourceAddedAt,
      source_updated_at: parsed.sourceUpdatedAt,
      row_hash: parsed.rowHash,
      variant: {
        variant_name: parsed.variantName,
        color: parsed.color,
        material: parsed.material,
        raw_payload: parsed.variantRawPayload,
      },
      commercial: {
        source_available_qty: parsed.sourceAvailableQty,
        owned_qty: parsed.ownedQty,
        source_unit_price: parsed.sourceUnitPrice,
        discounted_unit_price: parsed.discountedUnitPrice,
        fulfillment_fee: parsed.fulfillmentFee,
        effective_cost_price: parsed.effectiveCostPrice,
        inventory_status: parsed.inventoryStatus,
        restock_date: parsed.restockDate,
        raw_payload: parsed.commercialRawPayload,
      },
    };

    rowsToUpsert.push({
      run_id: runId,
      row_index: parsed.index,
      source_key: parsed.itemCode,
      row_hash: parsed.rowHash,
      raw_row: rawRow as Record<string, unknown>,
      normalized_status: 'succeeded',
    });

    const resultType = existingRowHashes.has(parsed.index) ? 'updated' : 'created';
    results.results.push({
      row_index: parsed.index,
      item_code: variant.item_code,
      variant_id: variant.id,
      result: resultType,
    });
  }

  if (rowsToUpsert.length > 0) {
    const commercialBody: Record<string, unknown>[] = [];
    for (const row of rowsToUpsert) {
      const mapping = variantsToResolve.get(row.row_index);
      if (!mapping) continue;
      const parsed = parsedRows.find((r) => r.index === row.row_index);
      if (!parsed) continue;

      const entry: Record<string, unknown> = {
        variant_id: mapping.variantId,
        source_available_qty: parsed.sourceAvailableQty,
        owned_qty: parsed.ownedQty,
        source_unit_price: parsed.sourceUnitPrice,
        discounted_unit_price: parsed.discountedUnitPrice,
        fulfillment_fee: parsed.fulfillmentFee,
        effective_cost_price: parsed.effectiveCostPrice,
        inventory_status: parsed.inventoryStatus,
        restock_date: parsed.restockDate,
        sync_status: 'synced',
        last_sync_success_at: runObj.window_end,
        raw_payload: {
          ...(existingCommercialPayloads.get(mapping.variantId) ?? {}),
          gigab2b_saved: parsed.commercialRawPayload,
          catalogsync_source_import: {
            row_hash: parsed.rowHash,
            source_added_at: parsed.sourceAddedAt,
            source_updated_at: parsed.sourceUpdatedAt,
          },
        },
      };

      commercialBody.push(entry);
    }

    if (commercialBody.length > 0) {
      try {
        await postgrestWrite(supabaseEnv, 'product_commercials', commercialBody, fetchFn, 'variant_id');
      } catch (error) {
        console.error('source-import commercial upsert failed', error);
        return json({ error: 'catalog_upstream_error' }, 502);
      }
    }

    // Record a source row as succeeded only after its canonical commercial
    // state is durable. Otherwise an identical replay could incorrectly skip
    // repair after a partial failure.
    try {
      await postgrestWrite(supabaseEnv, 'source_import_rows', rowsToUpsert, fetchFn, 'run_id,row_index');
    } catch (error) {
      console.error('source-import row upsert failed', error);
      return json({ error: 'catalog_upstream_error' }, 502);
    }
  }

  try {
    const patchUrl = new URL(`/rest/v1/source_import_runs?id=eq.${runId}`, supabaseEnv.SUPABASE_URL.replace(/\/$/, ''));
    const patchBody = {
      status: 'succeeded',
      row_count: parsedRows.length,
      finished_at: new Date().toISOString(),
    };
    const patchResp = await fetchFn(patchUrl, {
      method: 'PATCH',
      headers: {
        apikey: supabaseEnv.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${supabaseEnv.SUPABASE_SERVICE_ROLE_KEY}`,
        'content-type': 'application/json',
        accept: 'application/json',
        prefer: 'return=representation',
      },
      body: JSON.stringify(patchBody),
    });
    if (!patchResp.ok) {
      throw new Error(`source-import run patch failed: ${await patchResp.text().catch(() => 'unknown')}`);
    }
  } catch (error) {
    console.error('source-import run finalization failed', error);
    return json({ error: 'catalog_upstream_error' }, 502);
  }

  results.results.sort((a, b) => {
    const ai = 'row_index' in a ? (a as { row_index: number }).row_index : 0;
    const bi = 'row_index' in b ? (b as { row_index: number }).row_index : 0;
    return ai - bi;
  });

  return json(results);
}

const MERCARI_SHOPS = ['shop1', 'shop2', 'shop3', 'shop4'];

export async function handleListingCandidatesQuery(
  request: Request,
  env: InternalCatalogEnv,
  fetchFn: FetchLike = fetch,
): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
  }

  if (!pipelineConfigurationReady(env)) return json({ error: 'service_not_configured' }, 503);
  if (!pipelineAuthorized(request, env)) {
    return json({ error: 'unauthorized' }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'invalid_request', message: 'body must be a JSON object' }, 400);
  }

  const bodyObj = body as Record<string, unknown>;
  const topKeys = Object.keys(bodyObj);
  if (topKeys.length !== 1 || !('item_codes' in bodyObj)) {
    return json({ error: 'invalid_request', message: 'body must contain only item_codes' }, 400);
  }

  const itemCodesVal = bodyObj.item_codes;
  if (!Array.isArray(itemCodesVal) || itemCodesVal.length < 1 || itemCodesVal.length > 100) {
    return json({ error: 'invalid_item_codes', message: 'item_codes must be an array of 1-100 items' }, 400);
  }

  const requestedItems: Array<{ requestedItemCode: string; identity: string }> = [];
  const seen = new Set<string>();
  for (const value of itemCodesVal) {
    if (typeof value !== 'string' || !value.trim() || value.length > 128) {
      return json(
        { error: 'invalid_item_code', message: 'each item code must be a non-empty string of at most 128 characters' },
        400,
      );
    }
    const code = value.trim();
    const ident = identityKey(code);
    if (seen.has(ident)) {
      return json({ error: 'duplicate_request_item_code', item_code: code }, 400);
    }
    seen.add(ident);
    requestedItems.push({ requestedItemCode: code, identity: ident });
  }

  const supabaseEnv = {
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
  };

  let variantRows: unknown[];
  try {
    variantRows = [];
    for (const batch of chunks(requestedItems, 50)) {
      variantRows.push(...await supabaseRows(
        supabaseEnv,
        'product_variants',
        {
          select: 'id,item_code,variant_name,color,material,raw_payload',
          or: postgrestExactIlikeOr(batch.map(({ identity }) => identity)),
          limit: '101',
        },
        fetchFn,
      ));
    }
  } catch (error) {
    console.error('listing-candidates variant read failed', error);
    return json({ error: 'catalog_upstream_error' }, 502);
  }

  const variantsByIdentity = new Map<string, Array<{
    id: string;
    item_code: string;
    variant_name: string | null;
    color: string | null;
    material: string | null;
    raw_payload: Record<string, unknown> | null;
  }>>();

  for (const value of variantRows) {
    const row = value as Record<string, unknown>;
    if (typeof row.id !== 'string' || typeof row.item_code !== 'string') continue;
    const key = identityKey(row.item_code as string);
    const matches = variantsByIdentity.get(key) ?? [];
    matches.push({
      id: row.id as string,
      item_code: row.item_code as string,
      variant_name: typeof row.variant_name === 'string' ? row.variant_name : null,
      color: typeof row.color === 'string' ? row.color : null,
      material: typeof row.material === 'string' ? row.material : null,
      raw_payload: row.raw_payload && typeof row.raw_payload === 'object' && !Array.isArray(row.raw_payload)
        ? row.raw_payload as Record<string, unknown> : null,
    });
    variantsByIdentity.set(key, matches);
  }

  const unambiguousVariants = requestedItems.flatMap(({ identity }) => {
    const matches = variantsByIdentity.get(identity) ?? [];
    return matches.length === 1 ? matches : [];
  });

  const variantIds = unambiguousVariants.map((v) => v.id);

  let commercialRows: unknown[];
  try {
    commercialRows = variantIds.length === 0
      ? []
      : await supabaseRows(
        supabaseEnv,
        'product_commercials',
        {
          select: 'variant_id,source_available_qty,owned_qty,source_unit_price,discounted_unit_price,fulfillment_fee,effective_cost_price,effective_tcogs,mercari_effective_price_excl_shipping,mercari_effective_price_incl_shipping,inventory_status,restock_date,sync_status,last_sync_success_at,raw_payload',
          variant_id: postgrestIn(variantIds),
          limit: String(variantIds.length + 1),
        },
        fetchFn,
      );
  } catch (error) {
    console.error('listing-candidates commercial read failed', error);
    return json({ error: 'catalog_upstream_error' }, 502);
  }

  const commercialsByVariantId = new Map<string, Record<string, unknown>>();
  for (const value of commercialRows) {
    const row = value as Record<string, unknown>;
    if (typeof row.variant_id !== 'string') continue;
    commercialsByVariantId.set(row.variant_id, row);
  }

  let listingRows: unknown[];
  // Select the full v2.0 lifecycle columns.  If the migration hasn't been
  // applied yet the new columns won't exist — fall back to legacy columns
  // so the endpoint remains usable before migration.
  const LIFECYCLE_COLUMNS = [
    'lifecycle_stage', 'content_revision', 'content_origin',
    'title', 'description', 'images',
    'score_total', 'score_modules', 'scored_content_revision', 'scored_at',
    'score_config_version', 'score_config_hash',
    'enhancement_key', 'enhancement_model',
    'published_content_revision', 'published_at',
  ];
  const LEGACY_SELECT = [
    'id', 'variant_id', 'external_listing_id', 'external_sku_id',
    'shop_code', 'listing_status', 'raw_payload',
  ];
  const V2_SELECT = [...LEGACY_SELECT, ...LIFECYCLE_COLUMNS];

  try {
    listingRows = variantIds.length === 0
      ? []
      : await supabaseRows(
        supabaseEnv,
        'platform_listings',
        {
          select: V2_SELECT.join(','),
          platform: `eq.mercari`,
          variant_id: postgrestIn(variantIds),
          shop_code: postgrestIn(MERCARI_SHOPS),
          limit: String(variantIds.length * MERCARI_SHOPS.length + 1),
        },
        fetchFn,
      );
  } catch (_v2Error) {
    // Pre-migration fallback: new columns don't exist yet.
    // Retry with only the legacy column set.
    console.warn('listing-candidates v2 select failed, falling back to legacy columns');
    try {
      listingRows = variantIds.length === 0
        ? []
        : await supabaseRows(
          supabaseEnv,
          'platform_listings',
          {
            select: LEGACY_SELECT.join(','),
            platform: `eq.mercari`,
            variant_id: postgrestIn(variantIds),
            shop_code: postgrestIn(MERCARI_SHOPS),
            limit: String(variantIds.length * MERCARI_SHOPS.length + 1),
          },
          fetchFn,
        );
    } catch (error) {
      console.error('listing-candidates listing read failed', error);
      return json({ error: 'catalog_upstream_error' }, 502);
    }
  }

  const listingIds: string[] = [];
  const listingsByVariantAndShop = new Map<string, Map<string, Array<{
    id: string;
    external_listing_id: string | null;
    listing_status: string | null;
    raw_payload: Record<string, unknown> | null;
    lifecycle_stage: string | null;
    content_revision: number | null;
    content_origin: string | null;
    title: string | null;
    description: string | null;
    images: unknown[] | null;
    score_total: number | null;
    score_modules: Record<string, unknown> | null;
    scored_content_revision: number | null;
    scored_at: string | null;
    score_config_version: string | null;
    score_config_hash: string | null;
    enhancement_key: string | null;
    enhancement_model: string | null;
    published_content_revision: number | null;
    published_at: string | null;
  }>>>();

  for (const value of listingRows) {
    const row = value as Record<string, unknown>;
    if (typeof row.id !== 'string' || typeof row.variant_id !== 'string' || typeof row.shop_code !== 'string') continue;
    listingIds.push(row.id as string);

    let shopMap = listingsByVariantAndShop.get(row.variant_id as string);
    if (!shopMap) {
      shopMap = new Map();
      listingsByVariantAndShop.set(row.variant_id as string, shopMap);
    }

    const entries = shopMap.get(row.shop_code as string) ?? [];
    entries.push({
      id: row.id as string,
      external_listing_id: typeof row.external_listing_id === 'string' ? row.external_listing_id : null,
      listing_status: typeof row.listing_status === 'string' ? row.listing_status : null,
      raw_payload: row.raw_payload && typeof row.raw_payload === 'object' && !Array.isArray(row.raw_payload)
        ? row.raw_payload as Record<string, unknown> : null,
      lifecycle_stage: typeof row.lifecycle_stage === 'string' ? row.lifecycle_stage : null,
      content_revision: typeof row.content_revision === 'number' ? row.content_revision : null,
      content_origin: typeof row.content_origin === 'string' ? row.content_origin : null,
      title: typeof row.title === 'string' ? row.title : null,
      description: typeof row.description === 'string' ? row.description : null,
      images: Array.isArray(row.images) ? row.images : null,
      score_total: typeof row.score_total === 'number' ? row.score_total : null,
      score_modules: row.score_modules && typeof row.score_modules === 'object' && !Array.isArray(row.score_modules)
        ? row.score_modules as Record<string, unknown> : null,
      scored_content_revision: typeof row.scored_content_revision === 'number' ? row.scored_content_revision : null,
      scored_at: typeof row.scored_at === 'string' ? row.scored_at : null,
      score_config_version: typeof row.score_config_version === 'string' ? row.score_config_version : null,
      score_config_hash: typeof row.score_config_hash === 'string' ? row.score_config_hash : null,
      enhancement_key: typeof row.enhancement_key === 'string' ? row.enhancement_key : null,
      enhancement_model: typeof row.enhancement_model === 'string' ? row.enhancement_model : null,
      published_content_revision: typeof row.published_content_revision === 'number' ? row.published_content_revision : null,
      published_at: typeof row.published_at === 'string' ? row.published_at : null,
    });
    shopMap.set(row.shop_code as string, entries);
  }

  let skuRows: unknown[];
  try {
    skuRows = listingIds.length === 0
      ? []
      : await supabaseRows(
        supabaseEnv,
        'platform_listing_skus',
        {
          select: 'listing_id,external_sku_id,sku_code,sku_status,raw_payload',
          listing_id: postgrestIn(listingIds),
          sku_position: 'eq.1',
          limit: String(listingIds.length + 1),
        },
        fetchFn,
      );
  } catch (error) {
    console.error('listing-candidates SKU read failed', error);
    return json({ error: 'catalog_upstream_error' }, 502);
  }

  const skusByListingId = new Map<string, Array<{
    external_sku_id: string | null;
    sku_code: string | null;
    sku_status: string | null;
    raw_payload: Record<string, unknown> | null;
  }>>();

  for (const value of skuRows) {
    const row = value as Record<string, unknown>;
    if (typeof row.listing_id !== 'string') continue;
    const entries = skusByListingId.get(row.listing_id) ?? [];
    entries.push({
      external_sku_id: typeof row.external_sku_id === 'string' ? row.external_sku_id : null,
      sku_code: typeof row.sku_code === 'string' ? row.sku_code : null,
      sku_status: typeof row.sku_status === 'string' ? row.sku_status : null,
      raw_payload: row.raw_payload && typeof row.raw_payload === 'object' && !Array.isArray(row.raw_payload)
        ? row.raw_payload as Record<string, unknown> : null,
    });
    skusByListingId.set(row.listing_id, entries);
  }

  if (unambiguousVariants.length > 0) {
    const variantByItemCodeIdentity = new Map<string, string>();
    const canonicalCodes: string[] = [];
    for (const v of unambiguousVariants) {
      variantByItemCodeIdentity.set(identityKey(v.item_code), v.id);
      canonicalCodes.push(v.item_code);
    }

    let legacySkuRows: unknown[];
    try {
      legacySkuRows = [];
      for (const batch of chunks(canonicalCodes, 50)) {
        // At most four linked plus four legacy rows per SKU can be relevant
        // (one per Mercari shop in each set). Read one extra row and fail closed
        // instead of silently truncating an ambiguous identity set.
        const maxExpectedRows = batch.length * MERCARI_SHOPS.length * 2;
        const orFilter = `(${batch.map((c) => {
          const escaped = c.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '\\%').replace(/_/g, '\\_');
          return `sku_code.ilike."${escaped}"`;
        }).join(',')})`;
        const batchRows = await supabaseRows(
          supabaseEnv,
          'platform_listing_skus',
          {
            select: 'listing_id,external_sku_id,sku_code,sku_status,raw_payload',
            sku_position: 'eq.1',
            or: orFilter,
            limit: String(maxExpectedRows + 1),
          },
          fetchFn,
        );
        if (batchRows.length > maxExpectedRows) {
          throw new Error('legacy SKU identity set exceeded safety ceiling');
        }
        legacySkuRows.push(...batchRows);
      }
    } catch (error) {
      console.error('listing-candidates legacy SKU read failed', error);
      return json({ error: 'catalog_upstream_error' }, 502);
    }

    const legacySkuByListingId = new Map<string, Array<{
      external_sku_id: string | null;
      sku_code: string | null;
      sku_status: string | null;
      raw_payload: Record<string, unknown> | null;
    }>>();

    for (const value of legacySkuRows) {
      const row = value as Record<string, unknown>;
      if (typeof row.listing_id !== 'string') continue;
      const entries = legacySkuByListingId.get(row.listing_id) ?? [];
      entries.push({
        external_sku_id: typeof row.external_sku_id === 'string' ? row.external_sku_id : null,
        sku_code: typeof row.sku_code === 'string' ? row.sku_code : null,
        sku_status: typeof row.sku_status === 'string' ? row.sku_status : null,
        raw_payload: row.raw_payload && typeof row.raw_payload === 'object' && !Array.isArray(row.raw_payload)
          ? row.raw_payload as Record<string, unknown> : null,
      });
      legacySkuByListingId.set(row.listing_id, entries);
    }

    const linkedListingIds = new Set(listingIds);
    const legacyListingIds = [...new Set(
      [...legacySkuByListingId.keys()].filter((listingId) => !linkedListingIds.has(listingId)),
    )];

    if (legacyListingIds.length > 0) {
      let legacyListingRows: unknown[];
      try {
        legacyListingRows = [];
        for (const batch of chunks(legacyListingIds, 50)) {
          legacyListingRows.push(...await supabaseRows(
            supabaseEnv,
            'platform_listings',
            {
              select: 'id,variant_id,external_listing_id,shop_code,listing_status,raw_payload',
              id: postgrestIn(batch),
              variant_id: 'is.null',
              platform: 'eq.mercari',
              shop_code: postgrestIn(MERCARI_SHOPS),
              limit: String(batch.length + 1),
            },
            fetchFn,
          ));
        }
      } catch (error) {
        console.error('listing-candidates legacy listing read failed', error);
        return json({ error: 'catalog_upstream_error' }, 502);
      }

      for (const value of legacyListingRows) {
        const row = value as Record<string, unknown>;
        if (typeof row.id !== 'string' || typeof row.shop_code !== 'string') continue;
        if (row.variant_id !== null) continue;

        const listingId = row.id as string;
        const shopCode = row.shop_code as string;

        const legacySkus = legacySkuByListingId.get(listingId) ?? [];
        const legacySku = legacySkus.length >= 1 ? legacySkus[0] : null;
        if (!legacySku || !legacySku.sku_code) continue;

        const skuIdentity = identityKey(legacySku.sku_code);
        const mappedVariantId = variantByItemCodeIdentity.get(skuIdentity);
        if (!mappedVariantId) continue;

        let shopMap = listingsByVariantAndShop.get(mappedVariantId);
        if (!shopMap) {
          shopMap = new Map();
          listingsByVariantAndShop.set(mappedVariantId, shopMap);
        }

        const shopEntries = shopMap.get(shopCode) ?? [];
        shopEntries.push({
          id: listingId,
          external_listing_id: typeof row.external_listing_id === 'string' ? row.external_listing_id : null,
          listing_status: typeof row.listing_status === 'string' ? row.listing_status : null,
          raw_payload: row.raw_payload && typeof row.raw_payload === 'object' && !Array.isArray(row.raw_payload)
            ? row.raw_payload as Record<string, unknown> : null,
          lifecycle_stage: null,
          content_revision: null,
          content_origin: null,
          title: null,
          description: null,
          images: null,
          score_total: null,
          score_modules: null,
          scored_content_revision: null,
          scored_at: null,
          score_config_version: null,
          score_config_hash: null,
          enhancement_key: null,
          enhancement_model: null,
          published_content_revision: null,
          published_at: null,
        });
        shopMap.set(shopCode, shopEntries);

        if (!skusByListingId.has(listingId)) {
          skusByListingId.set(listingId, legacySkus);
        }
      }
    }
  }

  function extractTimestampFromState(rawPayload: Record<string, unknown> | null, field: string): string | null {
    if (!rawPayload) return null;
    const state = rawPayload.catalogsync_listing_state;
    if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
    const val = (state as Record<string, unknown>)[field];
    return typeof val === 'string' ? val : null;
  }

  const results: ListingCandidatesResponse = { results: [] };

  for (const { requestedItemCode, identity } of requestedItems) {
    const variantMatches = variantsByIdentity.get(identity) ?? [];

    if (variantMatches.length === 0) {
      results.results.push({ item_code: requestedItemCode, error: 'sku_not_found' });
      continue;
    }
    if (variantMatches.length > 1) {
      results.results.push({ item_code: requestedItemCode, error: 'duplicate_item_code' });
      continue;
    }

    const variant = variantMatches[0];
    const commercial = commercialsByVariantId.get(variant.id);
    if (!commercial) {
      results.results.push({ item_code: variant.item_code, error: 'commercial_state_missing' });
      continue;
    }

    const shopMap = listingsByVariantAndShop.get(variant.id) ?? new Map();

    let hasMappingConflict = false;
    for (const [shopCode, listingArr] of shopMap.entries()) {
      for (const listing of listingArr) {
        // Draft/enhanced listings without external IDs are valid (pre-publication).
        // Only flag conflict when a listing HAS external IDs but incomplete SKU data.
        if (listing.external_listing_id) {
          const skus = skusByListingId.get(listing.id) ?? [];
          if (skus.length !== 1 || !skus[0].external_sku_id || !skus[0].sku_code) {
            hasMappingConflict = true;
            break;
          }
        }
      }
      if (hasMappingConflict) break;
    }

    for (const shopCode of MERCARI_SHOPS) {
      const listingArr = shopMap.get(shopCode);
      if (listingArr && listingArr.length > 1) {
        hasMappingConflict = true;
        break;
      }
    }

    if (hasMappingConflict) {
      results.results.push({ item_code: variant.item_code, error: 'listing_mapping_conflict' });
      continue;
    }

    const mercariMappings: Record<string, MercariMapping | null> = {};
    for (const shopCode of MERCARI_SHOPS) {
      const listingArr = shopMap.get(shopCode);
      if (!listingArr || listingArr.length === 0) {
        mercariMappings[shopCode] = null;
        continue;
      }

      const listing = listingArr[0];
      const skus = skusByListingId.get(listing.id) ?? [];
      const sku = skus.length >= 1 ? skus[0] : null;

      mercariMappings[shopCode] = {
        shop_code: shopCode,
        external_listing_id: listing.external_listing_id ?? '',
        external_sku_id: sku?.external_sku_id ?? null,
        sku_code: sku?.sku_code ?? null,
        status: listing.listing_status ?? sku?.sku_status ?? null,
        queued_at: extractTimestampFromState(listing.raw_payload, 'queued_at')
          ?? extractTimestampFromState(sku?.raw_payload ?? null, 'queued_at'),
        opened_at: extractTimestampFromState(listing.raw_payload, 'opened_at')
          ?? extractTimestampFromState(sku?.raw_payload ?? null, 'opened_at'),
        // ── v2.0 lifecycle fields ──
        listing_id: listing.id,
        lifecycle_stage: listing.lifecycle_stage ?? undefined,
        content_revision: listing.content_revision ?? undefined,
        content_origin: listing.content_origin ?? undefined,
        title: listing.title,
        description: listing.description,
        images: listing.images,
        score_total: listing.score_total ?? undefined,
        score_modules: listing.score_modules ?? undefined,
        scored_content_revision: listing.scored_content_revision ?? undefined,
        scored_at: listing.scored_at ?? undefined,
        score_config_version: listing.score_config_version ?? undefined,
        score_config_hash: listing.score_config_hash ?? undefined,
        enhancement_key: listing.enhancement_key ?? undefined,
        enhancement_model: listing.enhancement_model ?? undefined,
        published_content_revision: listing.published_content_revision ?? undefined,
        published_at: listing.published_at ?? undefined,
      };
    }

    const commercialPayload = commercial.raw_payload;
    const commercialRaw: Record<string, unknown> | null =
      commercialPayload && typeof commercialPayload === 'object' && !Array.isArray(commercialPayload)
        ? commercialPayload as Record<string, unknown> : null;

    results.results.push({
      variant_id: variant.id,
      item_code: variant.item_code,
      variant_name: variant.variant_name,
      color: variant.color,
      material: variant.material,
      variant_raw_payload: variant.raw_payload,
      commercial_raw_payload: commercialRaw,
      source_available_qty: typeof commercial.source_available_qty === 'number' ? commercial.source_available_qty : null,
      owned_qty: typeof commercial.owned_qty === 'number' ? commercial.owned_qty : null,
      source_unit_price: typeof commercial.source_unit_price === 'number' ? commercial.source_unit_price : null,
      discounted_unit_price: typeof commercial.discounted_unit_price === 'number' ? commercial.discounted_unit_price : null,
      fulfillment_fee: typeof commercial.fulfillment_fee === 'number' ? commercial.fulfillment_fee : null,
      effective_cost_price: typeof commercial.effective_cost_price === 'number' ? commercial.effective_cost_price : null,
      effective_tcogs: typeof commercial.effective_tcogs === 'number' ? commercial.effective_tcogs : null,
      mercari_effective_price_excl_shipping: typeof commercial.mercari_effective_price_excl_shipping === 'number'
        ? commercial.mercari_effective_price_excl_shipping : null,
      mercari_effective_price_incl_shipping: typeof commercial.mercari_effective_price_incl_shipping === 'number'
        ? commercial.mercari_effective_price_incl_shipping : null,
      inventory_status: typeof commercial.inventory_status === 'string' ? commercial.inventory_status : null,
      restock_date: typeof commercial.restock_date === 'string' ? commercial.restock_date : null,
      sync_status: typeof commercial.sync_status === 'string' ? commercial.sync_status : null,
      last_sync_success_at: typeof commercial.last_sync_success_at === 'string' ? commercial.last_sync_success_at : null,
      mercari_mappings: mercariMappings,
    });
  }

  return json(results);
}
