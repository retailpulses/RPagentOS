export interface InternalCatalogEnv {
  INTERNAL_CATALOG_API_TOKEN?: string;
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

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const JSON_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

function tokensEqual(actual: string, expected: string): boolean {
  const length = Math.max(actual.length, expected.length);
  let mismatch = actual.length ^ expected.length;

  for (let index = 0; index < length; index += 1) {
    mismatch |= (actual.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  }

  return mismatch === 0;
}

function bearerToken(request: Request): string | null {
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

function postgrestIn(values: string[]): string {
  const quoted = values.map((value) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  return `in.(${quoted.join(',')})`;
}

function identityKey(value: string): string {
  return value.toUpperCase();
}

function postgrestExactIlikeOr(values: string[]): string {
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

function chunks<T>(values: T[], size: number): T[][] {
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

async function supabaseRows(
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

function validateIsoTimestamp(value: string): boolean {
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

      const currentStatus = existingListing.listing_status ?? '__missing__';
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
