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
