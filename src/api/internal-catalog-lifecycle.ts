/**
 * v2.0 Listing Lifecycle API handlers.
 *
 * These extend the product-catalog owner contract with lifecycle-aware
 * listing endpoints: draft materialization, revision-checked content
 * updates, score persistence, publication claims, and observations.
 *
 * All handlers require pipeline authorization and Supabase configuration.
 */

import {
  type InternalCatalogEnv,
  type LifecycleStage,
  type DraftMaterializationResponse,
  type ListingContentUpdateResponse,
  type ListingScoresBatchResponse,
  type PublishClaimResult,
  type PublishFinalizationResult,
  type PublishReleaseResult,
  type ListingLifecycleResult,
  type ListingObservationsResponse,
  type ListingsStageQueryResponse,
  type CanonicalListingContent,
  tokensEqual,
  bearerToken,
  pipelineAuthorized,
  pipelineConfigurationReady,
  postgrestIn,
  postgrestExactIlikeOr,
  identityKey,
  chunks,
  supabaseRows,
  validateIsoTimestamp,
} from './internal-catalog.js';

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

// Re-export helper functions used by the route wrappers.  Keep the
// implementation in one place so the contract doesn't drift.
export { pipelineAuthorized, pipelineConfigurationReady };

// ── Helpers ───────────────────────────────────────────────────────────

const MERCARI_SHOPS = ['shop1', 'shop2', 'shop3', 'shop4'];

const VALID_LIFECYCLE_STAGES = new Set<LifecycleStage>([
  'draft', 'enhanced', 'publish_pending', 'published', 'retired',
]);

function parseRouteIdParam(url: URL, prefix: string): string | null {
  // Cloudflare Pages passes [id] segments as path parts.
  // The route file extracts the id and passes it explicitly;
  // this fallback parses from the pathname for direct callers.
  const path = url.pathname;
  const idx = path.indexOf(prefix);
  if (idx === -1) return null;
  const after = path.slice(idx + prefix.length);
  const id = after.split('/')[0];
  return id || null;
}

function validateUuid(value: string): boolean {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
}

function requireUuid(value: string | null, label: string): string {
  if (!value || !validateUuid(value)) {
    throw new Error(`invalid ${label}: must be a UUID`);
  }
  return value;
}

function requireNonEmptyString(value: unknown, label: string, maxLen = 5000): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (value.length > maxLen) {
    throw new Error(`${label} exceeds max length of ${maxLen}`);
  }
  return value.trim();
}

async function fetchSingleListing(
  supabaseEnv: { SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY: string },
  listingId: string,
  fetchFn: typeof fetch,
): Promise<Record<string, unknown> | null> {
  const rows = await supabaseRows(
    supabaseEnv,
    'platform_listings',
    {
      select: [
        'id', 'platform', 'shop_code', 'variant_id',
        'external_listing_id', 'listing_status',
        'lifecycle_stage', 'content_revision', 'content_origin',
        'title', 'description', 'images',
        'score_total', 'scored_content_revision',
        'publish_claim_id', 'publish_idempotency_key', 'publish_claimed_at',
        'published_content_revision',
        'enhancement_key',
      ].join(','),
      id: `eq.${listingId}`,
      limit: '1',
    },
    fetchFn,
  );
  if (!rows || rows.length === 0) return null;
  return rows[0] as Record<string, unknown>;
}

function listingRowToCanonicalContent(row: Record<string, unknown>): CanonicalListingContent {
  return {
    listing_id: row.id as string,
    shop_code: (row.shop_code as string) || '',
    lifecycle_stage: ((row.lifecycle_stage as string) || 'draft') as LifecycleStage,
    content_revision: typeof row.content_revision === 'number' ? row.content_revision : 1,
    content_origin: ((row.content_origin as string) || 'giga_generated') as CanonicalListingContent['content_origin'],
    title: typeof row.title === 'string' ? row.title : null,
    description: typeof row.description === 'string' ? row.description : null,
    images: Array.isArray(row.images) ? row.images : null,
    category_id: null,
    score_total: typeof row.score_total === 'number' ? row.score_total : null,
    score_modules: row.score_modules && typeof row.score_modules === 'object'
      ? row.score_modules as Record<string, unknown> : null,
    scored_content_revision: typeof row.scored_content_revision === 'number'
      ? row.scored_content_revision : null,
    scored_at: typeof row.scored_at === 'string' ? row.scored_at : null,
    external_listing_id: typeof row.external_listing_id === 'string' ? row.external_listing_id : null,
    external_sku_id: typeof row.external_sku_id === 'string' ? row.external_sku_id : null,
    listing_status: typeof row.listing_status === 'string' ? row.listing_status : null,
    enhancement_key: typeof row.enhancement_key === 'string' ? row.enhancement_key : null,
    enhancement_model: typeof row.enhancement_model === 'string' ? row.enhancement_model : null,
    published_content_revision: typeof row.published_content_revision === 'number'
      ? row.published_content_revision : null,
    published_at: typeof row.published_at === 'string' ? row.published_at : null,
  };
}

async function postgrestPatch(
  env: { SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY: string },
  table: string,
  idColumn: string,
  idValue: string,
  body: Record<string, unknown>,
  fetchFn: typeof fetch,
  expectedRevision?: number,
  extraFilters?: string[],
): Promise<Record<string, unknown> | null> {
  let filter = `${idColumn}=eq.${encodeURIComponent(idValue)}`;
  // Atomic revision guard: only patch if content_revision hasn't changed.
  if (expectedRevision !== undefined) {
    filter += `&content_revision=eq.${expectedRevision}`;
  }
  // Additional PostgREST filter clauses for atomic stage/claim predicates.
  if (extraFilters) {
    for (const f of extraFilters) {
      filter += `&${f}`;
    }
  }
  const url = new URL(`/rest/v1/${table}?${filter}`, env.SUPABASE_URL.replace(/\/$/, ''));
  const response = await fetchFn(url, {
    method: 'PATCH',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      accept: 'application/json',
      prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown');
    throw new Error(`PATCH ${table} failed HTTP ${response.status}: ${errorText}`);
  }
  const rows = await response.json() as Record<string, unknown>[];
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
}

// ── 1. Draft Materialization ──────────────────────────────────────────

export async function handleDraftMaterialization(
  request: Request,
  env: InternalCatalogEnv,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
  }

  if (!pipelineConfigurationReady(env)) return json({ error: 'service_not_configured' }, 503);
  if (!pipelineAuthorized(request, env)) return json({ error: 'unauthorized' }, 401);

  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'invalid_request' }, 400);
  }
  const req = body as Record<string, unknown>;

  const sourceVariantIds = req.source_variant_ids;
  if (!Array.isArray(sourceVariantIds) || sourceVariantIds.length < 1 || sourceVariantIds.length > 100) {
    return json({ error: 'invalid_source_variant_ids', message: 'must be array of 1-100 UUIDs' }, 400);
  }
  for (const id of sourceVariantIds) {
    if (typeof id !== 'string' || !validateUuid(id)) {
      return json({ error: 'invalid_variant_id', message: `not a UUID: ${id}` }, 400);
    }
  }

  const platform = requireNonEmptyString(req.platform, 'platform', 64);
  const shops = req.shops;
  if (!Array.isArray(shops) || shops.length < 1 || shops.length > 10) {
    return json({ error: 'invalid_shops' }, 400);
  }
  for (const s of shops) {
    if (typeof s !== 'string' || !s.trim()) return json({ error: 'invalid_shop_code' }, 400);
  }

  const sourceContentHash = requireNonEmptyString(req.source_content_hash, 'source_content_hash', 256);
  const initialTitle = requireNonEmptyString(req.initial_title || '', 'initial_title', 2000);
  const initialDescription = typeof req.initial_description === 'string' ? req.initial_description.trim() : '';
  const initialCategoryId = typeof req.initial_category_id === 'string' ? req.initial_category_id.trim() : '';
  const initialImages: string[] = Array.isArray(req.initial_images)
    ? req.initial_images.filter((i): i is string => typeof i === 'string').slice(0, 20)
    : [];

  const supabaseEnv = {
    SUPABASE_URL: env.SUPABASE_URL!,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY!,
  };

  // Look up variant IDs and item codes
  let variantRows: unknown[];
  try {
    variantRows = [];
    for (const batch of chunks(sourceVariantIds, 50)) {
      variantRows.push(...await supabaseRows(
        supabaseEnv, 'product_variants',
        { select: 'id,item_code', id: postgrestIn(batch), limit: String(batch.length + 1) },
        fetchFn,
      ));
    }
  } catch (error) {
    console.error('draft-materialize variant lookup failed', error);
    return json({ error: 'catalog_upstream_error' }, 502);
  }

  const variantMap = new Map<string, { id: string; item_code: string }>();
  for (const v of variantRows) {
    const row = v as Record<string, unknown>;
    if (typeof row.id === 'string') variantMap.set(row.id, { id: row.id, item_code: (row.item_code as string) || '' });
  }

  // Check existing listings to avoid overwriting protected rows
  let existingListings: unknown[];
  try {
    existingListings = [];
    for (const batch of chunks(sourceVariantIds, 50)) {
      existingListings.push(...await supabaseRows(
        supabaseEnv, 'platform_listings',
        {
          select: 'id,variant_id,shop_code,lifecycle_stage,content_origin',
          platform: `eq.${platform}`,
          variant_id: postgrestIn(batch),
          shop_code: postgrestIn(shops),
          limit: String(batch.length * shops.length + 1),
        },
        fetchFn,
      ));
    }
  } catch (error) {
    console.error('draft-materialize listing lookup failed', error);
    return json({ error: 'catalog_upstream_error' }, 502);
  }

  const existingKey = (vid: string, shop: string) => `${vid}|${shop}`;
  const existingMap = new Map<string, { id: string; lifecycle_stage: string; content_origin: string }>();
  for (const v of existingListings) {
    const row = v as Record<string, unknown>;
    if (typeof row.id !== 'string' || typeof row.variant_id !== 'string') continue;
    existingMap.set(existingKey(row.variant_id, (row.shop_code as string) || ''), {
      id: row.id,
      lifecycle_stage: (row.lifecycle_stage as string) || 'draft',
      content_origin: (row.content_origin as string) || 'giga_generated',
    });
  }

  const toUpsert: Record<string, unknown>[] = [];
  const results: DraftMaterializationResponse = { results: [] };

  for (const variantId of sourceVariantIds) {
    const variant = variantMap.get(variantId);
    if (!variant) {
      results.results.push({
        listing_id: '', shop_code: '', item_code: '',
        lifecycle_stage: 'draft', content_revision: 0,
        outcome: 'unchanged',
      });
      continue;
    }
    for (const shop of shops) {
      const key = existingKey(variantId, shop);
      const existing = existingMap.get(key);

      if (existing) {
        // Protected rows: don't overwrite ai_enhanced, operator, or published content
        const isProtected = existing.lifecycle_stage === 'published'
          || existing.lifecycle_stage === 'retired'
          || existing.content_origin !== 'giga_generated';
        if (isProtected) {
          results.results.push({
            listing_id: existing.id, shop_code: shop, item_code: variant.item_code,
            lifecycle_stage: existing.lifecycle_stage as LifecycleStage,
            content_revision: 1, outcome: 'protected',
          });
          continue;
        }
        // Existing giga_generated draft: skip if source content unchanged
        results.results.push({
          listing_id: existing.id, shop_code: shop, item_code: variant.item_code,
          lifecycle_stage: 'draft', content_revision: 1, outcome: 'unchanged',
        });
        continue;
      }

      // New draft — only includes columns that exist on platform_listings
      // (variant_id and lifecycle columns from migration, plus canonical content columns)
      toUpsert.push({
        platform,
        shop_code: shop,
        variant_id: variantId,
        source_variant_id: variantId,
        source_content_hash: sourceContentHash,
        lifecycle_stage: 'draft',
        content_revision: 1,
        content_origin: 'giga_generated',
        title: initialTitle,
        description: initialDescription,
        images: initialImages,
      });
    }
  }

  if (toUpsert.length > 0) {
    try {
      const insertUrl = new URL('/rest/v1/platform_listings', supabaseEnv.SUPABASE_URL.replace(/\/$/, ''));
      insertUrl.searchParams.set('on_conflict', 'platform,shop_code,variant_id');
      const response = await fetchFn(
        insertUrl,
        {
          method: 'POST',
          headers: {
            apikey: supabaseEnv.SUPABASE_SERVICE_ROLE_KEY,
            authorization: `Bearer ${supabaseEnv.SUPABASE_SERVICE_ROLE_KEY}`,
            'content-type': 'application/json',
            accept: 'application/json',
            prefer: 'resolution=ignore-duplicates,return=representation',
          },
          body: JSON.stringify(toUpsert),
        },
      );
      if (!response.ok) {
        const errText = await response.text().catch(() => 'unknown');
        throw new Error(`draft insert failed HTTP ${response.status}: ${errText}`);
      }
      const inserted = await response.json() as Record<string, unknown>[];
      for (const row of inserted) {
        if (typeof row.id === 'string' && typeof row.shop_code === 'string' && typeof row.variant_id === 'string') {
          const variant = variantMap.get(row.variant_id);
          results.results.push({
            listing_id: row.id,
            shop_code: row.shop_code,
            item_code: variant?.item_code ?? '',
            lifecycle_stage: 'draft' as LifecycleStage,
            content_revision: 1,
            outcome: 'created',
          });
        }
      }
    } catch (error) {
      console.error('draft-materialize insert failed', error);
      return json({ error: 'catalog_upstream_error' }, 502);
    }
  }

  return json(results);
}

// ── 2. Content Update (revision-checked) ──────────────────────────────

export async function handleListingContentUpdate(
  request: Request,
  env: InternalCatalogEnv,
  listingId: string,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== 'PATCH') {
    return json({ error: 'method_not_allowed' }, 405, { allow: 'PATCH' });
  }

  if (!pipelineConfigurationReady(env)) return json({ error: 'service_not_configured' }, 503);
  if (!pipelineAuthorized(request, env)) return json({ error: 'unauthorized' }, 401);

  try { requireUuid(listingId, 'listing_id'); } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }

  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'invalid_request' }, 400);
  }
  const req = body as Record<string, unknown>;

  const expectedRevision = req.expected_content_revision;
  if (typeof expectedRevision !== 'number' || !Number.isInteger(expectedRevision) || expectedRevision < 1) {
    return json({ error: 'invalid_expected_revision' }, 400);
  }

  const contentOrigin = req.content_origin;
  if (contentOrigin !== 'ai_enhanced' && contentOrigin !== 'operator') {
    return json({ error: 'invalid_content_origin', message: 'must be ai_enhanced or operator' }, 400);
  }

  const idempotencyKey = requireNonEmptyString(req.idempotency_key, 'idempotency_key', 256);

  const supabaseEnv = {
    SUPABASE_URL: env.SUPABASE_URL!,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY!,
  };

  const listing = await fetchSingleListing(supabaseEnv, listingId, fetchFn);
  if (!listing) return json({ error: 'listing_not_found' }, 404);

  const currentRevision = typeof listing.content_revision === 'number' ? listing.content_revision : 1;
  const currentStage = (listing.lifecycle_stage as string) || 'draft';

  // Stage guard: only draft and enhanced listings accept content updates.
  // publish_pending requires releasing the claim first; published requires
  // an explicit post-publication edit path; retired requires restore.
  if (currentStage !== 'draft' && currentStage !== 'enhanced') {
    return json({
      listing_id: listingId,
      content_revision: currentRevision,
      lifecycle_stage: currentStage as LifecycleStage,
      outcome: 'stale_revision',
    } satisfies ListingContentUpdateResponse, 409);
  }

  // Idempotency check (before stale-revision): if the stored enhancement_key
  // matches, this is a replay of a successful prior call.
  const storedEnhancementKey = typeof listing.enhancement_key === 'string' ? listing.enhancement_key : null;
  if (storedEnhancementKey === idempotencyKey) {
    return json({
      listing_id: listingId,
      content_revision: currentRevision,
      lifecycle_stage: currentStage as LifecycleStage,
      outcome: 'replay',
    } satisfies ListingContentUpdateResponse);
  }

  // Stale revision: the row has moved on since the caller read it.
  if (currentRevision > expectedRevision) {
    return json({
      listing_id: listingId,
      content_revision: currentRevision,
      lifecycle_stage: currentStage as LifecycleStage,
      outcome: 'stale_revision',
    } satisfies ListingContentUpdateResponse, 409);
  }

  // Build update
  const patch: Record<string, unknown> = {};
  const newTitle = req.title;
  const newDescription = req.description;
  const newImages = req.images;

  if (typeof newTitle === 'string' && newTitle.trim()) {
    patch.title = newTitle.trim().slice(0, 2000);
  }
  if (typeof newDescription === 'string' && newDescription.trim()) {
    patch.description = newDescription.trim().slice(0, 5000);
  }
  if (Array.isArray(newImages)) {
    patch.images = newImages.filter((i): i is string => typeof i === 'string').slice(0, 20);
  }

  if (Object.keys(patch).length === 0) {
    return json({ error: 'no_content_fields_provided' }, 400);
  }

  const newRevision = currentRevision + 1;
  const newStage = 'enhanced';
  patch.content_revision = newRevision;
  patch.lifecycle_stage = newStage;
  patch.content_origin = contentOrigin;
  patch.enhancement_key = idempotencyKey;
  patch.enhancement_model = typeof req.enhancement_model === 'string' ? req.enhancement_model : null;
  patch.enhancement_prompt_version = typeof req.enhancement_prompt_version === 'string'
    ? req.enhancement_prompt_version : null;
  patch.enhanced_at = new Date().toISOString();
  // Clear stale score
  patch.score_total = null;
  patch.score_modules = null;
  patch.scored_content_revision = null;
  patch.scored_at = null;
  patch.score_config_version = null;
  patch.score_config_hash = null;
  // Clear any unconsumed publish claim
  patch.publish_claim_id = null;
  patch.publish_claimed_at = null;

  try {
    const patched = await postgrestPatch(
      supabaseEnv, 'platform_listings', 'id', listingId, patch, fetchFn, expectedRevision,
    );
    if (!patched) {
      // Revision guard blocked the write — another writer changed the row.
      return json({
        listing_id: listingId,
        content_revision: currentRevision,
        lifecycle_stage: currentStage as LifecycleStage,
        outcome: 'stale_revision',
      } satisfies ListingContentUpdateResponse, 409);
    }
  } catch (error) {
    console.error('content-update patch failed', error);
    return json({ error: 'catalog_upstream_error' }, 502);
  }

  return json({
    listing_id: listingId,
    content_revision: newRevision,
    lifecycle_stage: newStage as LifecycleStage,
    outcome: 'updated',
  } satisfies ListingContentUpdateResponse);
}

// ── 3. Score Batch ────────────────────────────────────────────────────

export async function handleListingScoresBatch(
  request: Request,
  env: InternalCatalogEnv,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
  }

  if (!pipelineConfigurationReady(env)) return json({ error: 'service_not_configured' }, 503);
  if (!pipelineAuthorized(request, env)) return json({ error: 'unauthorized' }, 401);

  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'invalid_request' }, 400);
  }
  const req = body as Record<string, unknown>;
  const entries = req.entries;
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 100) {
    return json({ error: 'invalid_entries', message: 'must be array of 1-100 items' }, 400);
  }

  const supabaseEnv = {
    SUPABASE_URL: env.SUPABASE_URL!,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY!,
  };

  const results: ListingScoresBatchResponse = { results: [] };

  for (const entry of entries) {
    const e = entry as Record<string, unknown>;
    const listingId = e.listing_id;
    if (typeof listingId !== 'string' || !validateUuid(listingId)) {
      results.results.push({ listing_id: String(listingId || ''), outcome: 'not_found' });
      continue;
    }

    const expectedRevision = e.expected_content_revision;
    if (typeof expectedRevision !== 'number' || !Number.isInteger(expectedRevision) || expectedRevision < 1) {
      results.results.push({ listing_id: listingId, outcome: 'stale_revision' });
      continue;
    }

    const listing = await fetchSingleListing(supabaseEnv, listingId, fetchFn);
    if (!listing) {
      results.results.push({ listing_id: listingId, outcome: 'not_found' });
      continue;
    }

    const currentRevision = typeof listing.content_revision === 'number' ? listing.content_revision : 1;
    if (currentRevision !== expectedRevision) {
      results.results.push({ listing_id: listingId, outcome: 'stale_revision' });
      continue;
    }

    const total = e.total;
    const modules = e.modules;
    const configVersion = e.config_version;
    const configHash = e.config_hash;
    if (typeof total !== 'number' || total < 0 || total > 94) {
      results.results.push({ listing_id: listingId, outcome: 'stale_revision' });
      continue;
    }

    try {
      const patched = await postgrestPatch(supabaseEnv, 'platform_listings', 'id', listingId, {
        score_total: total,
        score_modules: modules && typeof modules === 'object' ? modules : null,
        score_config_version: typeof configVersion === 'string' ? configVersion : null,
        score_config_hash: typeof configHash === 'string' ? configHash : null,
        scored_content_revision: expectedRevision,
        scored_at: new Date().toISOString(),
      }, fetchFn, expectedRevision);
      if (!patched) {
        results.results.push({ listing_id: listingId, outcome: 'stale_revision' });
      } else {
        results.results.push({ listing_id: listingId, outcome: 'written' });
      }
    } catch (error) {
      console.error('score-write failed', error);
      results.results.push({ listing_id: listingId, outcome: 'not_found' });
    }
  }

  return json(results);
}

// ── 4. Stage Query ────────────────────────────────────────────────────

export async function handleListingsStageQuery(
  request: Request,
  env: InternalCatalogEnv,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  if (!pipelineConfigurationReady(env)) return json({ error: 'service_not_configured' }, 503);
  if (!pipelineAuthorized(request, env)) return json({ error: 'unauthorized' }, 401);

  const url = new URL(request.url);
  const platform = url.searchParams.get('platform') || 'mercari';
  const stage = url.searchParams.get('stage');
  const shopCode = url.searchParams.get('shop_code');
  const cursor = url.searchParams.get('cursor');
  const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 100);

  if (!stage || !VALID_LIFECYCLE_STAGES.has(stage as LifecycleStage)) {
    return json({ error: 'invalid_stage', message: 'stage query param required (draft|enhanced|publish_pending|published|retired)' }, 400);
  }

  const supabaseEnv = {
    SUPABASE_URL: env.SUPABASE_URL!,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY!,
  };

  const params: Record<string, string> = {
    select: [
      'id', 'shop_code', 'lifecycle_stage', 'content_revision', 'content_origin',
      'title', 'description', 'images',
      'score_total', 'score_modules', 'scored_content_revision', 'scored_at',
      'enhancement_key', 'enhancement_model',
      'external_listing_id', 'listing_status',
      'published_content_revision', 'published_at', 'updated_at',
    ].join(','),
    platform: `eq.${platform}`,
    lifecycle_stage: `eq.${stage}`,
    order: 'updated_at.desc',
    limit: String(limit + 1),
  };

  if (shopCode) params.shop_code = `eq.${shopCode}`;
  if (cursor) {
    const cursorDate = new Date(cursor);
    if (!Number.isNaN(cursorDate.getTime())) {
      params.updated_at = `lt.${cursorDate.toISOString()}`;
    }
  }

  try {
    const rows = await supabaseRows(supabaseEnv, 'platform_listings', params, fetchFn);
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);

    const listings: CanonicalListingContent[] = (items as Record<string, unknown>[]).map((r) =>
      listingRowToCanonicalContent(r as Record<string, unknown>)
    );

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const last = items[items.length - 1] as Record<string, unknown>;
      nextCursor = typeof last.updated_at === 'string' ? last.updated_at : null;
    }

    const response: ListingsStageQueryResponse = { listings, next_cursor: nextCursor };
    return json(response);
  } catch (error) {
    console.error('stage-query failed', error);
    return json({ error: 'catalog_upstream_error' }, 502);
  }
}

// ── 5. Publication Claim ──────────────────────────────────────────────

export async function handlePublishClaim(
  request: Request,
  env: InternalCatalogEnv,
  listingId: string,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
  }

  if (!pipelineConfigurationReady(env)) return json({ error: 'service_not_configured' }, 503);
  if (!pipelineAuthorized(request, env)) return json({ error: 'unauthorized' }, 401);

  try { requireUuid(listingId, 'listing_id'); } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }

  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'invalid_request' }, 400);
  }
  const req = body as Record<string, unknown>;

  const expectedRevision = req.expected_content_revision;
  if (typeof expectedRevision !== 'number' || !Number.isInteger(expectedRevision) || expectedRevision < 1) {
    return json({ error: 'invalid_expected_revision' }, 400);
  }
  const scoreTotal = req.score_total;
  if (typeof scoreTotal !== 'number' || scoreTotal < 0 || scoreTotal > 94) {
    return json({ error: 'invalid_score_total' }, 400);
  }
  const idempotencyKey = requireNonEmptyString(req.idempotency_key, 'idempotency_key', 256);

  const supabaseEnv = {
    SUPABASE_URL: env.SUPABASE_URL!,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY!,
  };

  const listing = await fetchSingleListing(supabaseEnv, listingId, fetchFn);
  if (!listing) return json({ error: 'listing_not_found' }, 404);

  const currentRevision = typeof listing.content_revision === 'number' ? listing.content_revision : 1;
  const currentStage = (listing.lifecycle_stage as string) || 'draft';
  const currentScore = typeof listing.score_total === 'number' ? listing.score_total : null;
  const scoredRevision = typeof listing.scored_content_revision === 'number'
    ? listing.scored_content_revision : null;
  const existingClaimId = typeof listing.publish_claim_id === 'string' ? listing.publish_claim_id : null;
  const storedIdempotencyKey = typeof listing.publish_idempotency_key === 'string'
    ? listing.publish_idempotency_key : null;

  // Replay: same idempotency key as a prior successful claim
  if (storedIdempotencyKey === idempotencyKey && existingClaimId) {
    return json({
      listing_id: listingId,
      claim_id: existingClaimId,
      content_revision: currentRevision,
      stage_before: currentStage as LifecycleStage,
      outcome: 'replay',
    } satisfies PublishClaimResult);
  }

  // Eligibility checks
  if (currentStage !== 'draft' && currentStage !== 'enhanced') {
    return json({
      listing_id: listingId, claim_id: '', content_revision: currentRevision,
      stage_before: currentStage as LifecycleStage, outcome: 'not_eligible',
    } satisfies PublishClaimResult, 409);
  }
  if (currentRevision !== expectedRevision || scoredRevision !== expectedRevision) {
    return json({
      listing_id: listingId, claim_id: '', content_revision: currentRevision,
      stage_before: currentStage as LifecycleStage, outcome: 'stale',
    } satisfies PublishClaimResult, 409);
  }
  if (currentScore === null || currentScore < 75) {
    return json({
      listing_id: listingId, claim_id: '', content_revision: currentRevision,
      stage_before: currentStage as LifecycleStage, outcome: 'not_eligible',
    } satisfies PublishClaimResult, 409);
  }

  const claimId = crypto.randomUUID();
  try {
    const patched = await postgrestPatch(supabaseEnv, 'platform_listings', 'id', listingId, {
      lifecycle_stage: 'publish_pending',
      publish_claim_id: claimId,
      publish_idempotency_key: idempotencyKey,
      publish_claimed_at: new Date().toISOString(),
    }, fetchFn, expectedRevision, [
      'lifecycle_stage=in.(draft,enhanced)',
      'publish_claim_id=is.null',
    ]);
    if (!patched) {
      return json({
        listing_id: listingId, claim_id: '', content_revision: currentRevision,
        stage_before: currentStage as LifecycleStage, outcome: 'stale',
      } satisfies PublishClaimResult, 409);
    }
  } catch (error) {
    console.error('publish-claim patch failed', error);
    return json({ error: 'catalog_upstream_error' }, 502);
  }

  return json({
    listing_id: listingId,
    claim_id: claimId,
    content_revision: currentRevision,
    stage_before: currentStage as LifecycleStage,
    outcome: 'claimed',
  } satisfies PublishClaimResult);
}

// ── 6. Publication Finalization ───────────────────────────────────────

export async function handlePublishFinalization(
  request: Request,
  env: InternalCatalogEnv,
  listingId: string,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
  }

  if (!pipelineConfigurationReady(env)) return json({ error: 'service_not_configured' }, 503);
  if (!pipelineAuthorized(request, env)) return json({ error: 'unauthorized' }, 401);

  try { requireUuid(listingId, 'listing_id'); } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }

  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'invalid_request' }, 400);
  }
  const req = body as Record<string, unknown>;

  const claimId = requireUuid(
    typeof req.claim_id === 'string' ? req.claim_id : null, 'claim_id',
  );
  const extListingId = requireNonEmptyString(req.external_listing_id, 'external_listing_id', 256);
  const extSkuId = requireNonEmptyString(req.external_sku_id, 'external_sku_id', 256);
  const skuCode = requireNonEmptyString(req.sku_code, 'sku_code', 128);
  const listingStatus = requireNonEmptyString(req.listing_status, 'listing_status', 64);
  const observedAt = requireNonEmptyString(req.observed_at, 'observed_at', 64);

  if (!validateIsoTimestamp(observedAt)) {
    return json({ error: 'invalid_observed_at' }, 400);
  }

  const supabaseEnv = {
    SUPABASE_URL: env.SUPABASE_URL!,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY!,
  };

  const listing = await fetchSingleListing(supabaseEnv, listingId, fetchFn);
  if (!listing) return json({ error: 'listing_not_found' }, 404);

  const currentStage = (listing.lifecycle_stage as string) || 'draft';
  const currentClaimId = typeof listing.publish_claim_id === 'string' ? listing.publish_claim_id : null;

  if (currentClaimId !== claimId) {
    return json({
      listing_id: listingId, outcome: 'claim_not_found',
    } satisfies PublishFinalizationResult);
  }

  // Replay detection
  const currentExtId = typeof listing.external_listing_id === 'string' ? listing.external_listing_id : null;
  if (currentExtId === extListingId && currentStage === 'published') {
    return json({
      listing_id: listingId, outcome: 'replay',
    } satisfies PublishFinalizationResult);
  }
  // Identity conflict
  if (currentExtId && currentExtId !== extListingId) {
    return json({
      listing_id: listingId, outcome: 'identity_conflict',
    } satisfies PublishFinalizationResult);
  }

  const publishedRevision = typeof listing.content_revision === 'number' ? listing.content_revision : 1;
  const now = new Date().toISOString();

  try {
    const patched = await postgrestPatch(supabaseEnv, 'platform_listings', 'id', listingId, {
      lifecycle_stage: 'published',
      listing_status: listingStatus,
      external_listing_id: extListingId,
      published_content_revision: publishedRevision,
      published_at: typeof listing.published_at === 'string' ? listing.published_at : now,
      observed_title: typeof req.observed_title === 'string' ? req.observed_title : null,
      observed_description: typeof req.observed_description === 'string' ? req.observed_description : null,
      observed_images: Array.isArray(req.observed_images) ? req.observed_images : null,
      observed_at: observedAt,
      content_drift: false,
      platform_updated_at: observedAt,
      publish_idempotency_key: null,
    }, fetchFn, undefined, [
      `publish_claim_id=eq.${claimId}`,
      'lifecycle_stage=eq.publish_pending',
    ]);
    if (!patched) {
      return json({
        listing_id: listingId, outcome: 'claim_not_found',
      } satisfies PublishFinalizationResult, 409);
    }
  } catch (error) {
    console.error('publish-finalize patch failed', error);
    return json({ error: 'catalog_upstream_error' }, 502);
  }

  return json({
    listing_id: listingId, outcome: 'finalized',
  } satisfies PublishFinalizationResult);
}

// ── 7. Publication Release ────────────────────────────────────────────

export async function handlePublishRelease(
  request: Request,
  env: InternalCatalogEnv,
  listingId: string,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
  }

  if (!pipelineConfigurationReady(env)) return json({ error: 'service_not_configured' }, 503);
  if (!pipelineAuthorized(request, env)) return json({ error: 'unauthorized' }, 401);

  try { requireUuid(listingId, 'listing_id'); } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }

  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'invalid_request' }, 400);
  }
  const req = body as Record<string, unknown>;
  const claimId = requireUuid(
    typeof req.claim_id === 'string' ? req.claim_id : null, 'claim_id',
  );
  const reason = requireNonEmptyString(req.reason, 'reason', 500);

  const supabaseEnv = {
    SUPABASE_URL: env.SUPABASE_URL!,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY!,
  };

  const listing = await fetchSingleListing(supabaseEnv, listingId, fetchFn);
  if (!listing) return json({ error: 'listing_not_found' }, 404);

  const currentClaimId = typeof listing.publish_claim_id === 'string' ? listing.publish_claim_id : null;
  if (currentClaimId !== claimId) {
    return json({
      listing_id: listingId, outcome: 'claim_not_found',
    } satisfies PublishReleaseResult);
  }

  const currentStage = (listing.lifecycle_stage as string) || 'draft';
  if (currentStage !== 'publish_pending') {
    return json({
      listing_id: listingId, outcome: 'not_pending',
    } satisfies PublishReleaseResult);
  }

  try {
    const patched = await postgrestPatch(supabaseEnv, 'platform_listings', 'id', listingId, {
      lifecycle_stage: 'enhanced',
      publish_claim_id: null,
      publish_claimed_at: null,
      publish_idempotency_key: null,
    }, fetchFn, undefined, [
      `publish_claim_id=eq.${claimId}`,
      'lifecycle_stage=eq.publish_pending',
    ]);
    if (!patched) {
      return json({
        listing_id: listingId, outcome: 'claim_not_found',
      } satisfies PublishReleaseResult, 409);
    }
  } catch (error) {
    console.error('publish-release patch failed', error);
    return json({ error: 'catalog_upstream_error' }, 502);
  }

  return json({
    listing_id: listingId, outcome: 'released',
  } satisfies PublishReleaseResult);
}

// ── 8. Retire / Restore ───────────────────────────────────────────────

export async function handleRetireListing(
  request: Request,
  env: InternalCatalogEnv,
  listingId: string,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
  }

  if (!pipelineConfigurationReady(env)) return json({ error: 'service_not_configured' }, 503);
  if (!pipelineAuthorized(request, env)) return json({ error: 'unauthorized' }, 401);

  try { requireUuid(listingId, 'listing_id'); } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }

  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'invalid_request' }, 400);
  }
  const req = body as Record<string, unknown>;
  const reason = requireNonEmptyString(req.reason, 'reason', 500);
  const expectedRevision = req.expected_content_revision;
  if (typeof expectedRevision !== 'number' || !Number.isInteger(expectedRevision) || expectedRevision < 1) {
    return json({ error: 'invalid_expected_revision' }, 400);
  }

  const supabaseEnv = {
    SUPABASE_URL: env.SUPABASE_URL!,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY!,
  };

  const listing = await fetchSingleListing(supabaseEnv, listingId, fetchFn);
  if (!listing) return json({ error: 'listing_not_found' }, 404);
  if (listing.lifecycle_stage === 'retired') {
    return json({
      listing_id: listingId, lifecycle_stage: 'retired',
      outcome: 'transitioned',
    } satisfies ListingLifecycleResult);
  }

  if (listing.lifecycle_stage !== 'published') {
    return json({
      listing_id: listingId, lifecycle_stage: listing.lifecycle_stage as LifecycleStage,
      outcome: 'not_published',
    } satisfies ListingLifecycleResult, 409);
  }

  try {
    const patched = await postgrestPatch(supabaseEnv, 'platform_listings', 'id', listingId, {
      lifecycle_stage: 'retired',
      retired_at: new Date().toISOString(),
      retirement_reason: reason,
    }, fetchFn, expectedRevision, ['lifecycle_stage=eq.published']);
    if (!patched) {
      return json({
        listing_id: listingId, lifecycle_stage: listing.lifecycle_stage as LifecycleStage,
        outcome: 'stale',
      } satisfies ListingLifecycleResult, 409);
    }
  } catch (error) {
    console.error('retire patch failed', error);
    return json({ error: 'catalog_upstream_error' }, 502);
  }

  return json({
    listing_id: listingId, lifecycle_stage: 'retired', outcome: 'transitioned',
  } satisfies ListingLifecycleResult);
}

export async function handleRestoreListing(
  request: Request,
  env: InternalCatalogEnv,
  listingId: string,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
  }

  if (!pipelineConfigurationReady(env)) return json({ error: 'service_not_configured' }, 503);
  if (!pipelineAuthorized(request, env)) return json({ error: 'unauthorized' }, 401);

  try { requireUuid(listingId, 'listing_id'); } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }

  const supabaseEnv = {
    SUPABASE_URL: env.SUPABASE_URL!,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY!,
  };

  const listing = await fetchSingleListing(supabaseEnv, listingId, fetchFn);
  if (!listing) return json({ error: 'listing_not_found' }, 404);
  if (listing.lifecycle_stage !== 'retired') {
    return json({ error: 'not_retired', message: 'only retired listings can be restored' }, 400);
  }

  try {
    const patched = await postgrestPatch(supabaseEnv, 'platform_listings', 'id', listingId, {
      lifecycle_stage: 'draft',
      content_revision: (typeof listing.content_revision === 'number' ? listing.content_revision : 1) + 1,
      retired_at: null,
      retirement_reason: null,
      score_total: null,
      score_modules: null,
      scored_content_revision: null,
      scored_at: null,
      publish_claim_id: null,
      publish_claimed_at: null,
    }, fetchFn, undefined, ['lifecycle_stage=eq.retired']);
    if (!patched) {
      return json({
        listing_id: listingId, lifecycle_stage: 'retired' as LifecycleStage,
        outcome: 'stale',
      } satisfies ListingLifecycleResult, 409);
    }
  } catch (error) {
    console.error('restore patch failed', error);
    return json({ error: 'catalog_upstream_error' }, 502);
  }

  return json({
    listing_id: listingId, lifecycle_stage: 'draft', outcome: 'transitioned',
  } satisfies ListingLifecycleResult);
}

// ── 9. Observations Batch (reconciliation) ────────────────────────────

export async function handleListingObservationsBatch(
  request: Request,
  env: InternalCatalogEnv,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
  }

  if (!pipelineConfigurationReady(env)) return json({ error: 'service_not_configured' }, 503);
  if (!pipelineAuthorized(request, env)) return json({ error: 'unauthorized' }, 401);

  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'invalid_request' }, 400);
  }
  const req = body as Record<string, unknown>;
  const observations = req.observations;
  if (!Array.isArray(observations) || observations.length < 1 || observations.length > 100) {
    return json({ error: 'invalid_observations' }, 400);
  }

  const supabaseEnv = {
    SUPABASE_URL: env.SUPABASE_URL!,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY!,
  };

  const results: ListingObservationsResponse = { results: [] };

  for (const obs of observations) {
    const o = obs as Record<string, unknown>;
    const listingId = o.listing_id;
    if (typeof listingId !== 'string' || !validateUuid(listingId)) {
      results.results.push({ listing_id: String(listingId || ''), outcome: 'not_found', content_drift: false });
      continue;
    }

    const listing = await fetchSingleListing(supabaseEnv, listingId, fetchFn);
    if (!listing) {
      results.results.push({ listing_id: listingId, outcome: 'not_found', content_drift: false });
      continue;
    }

    const externalId = typeof o.external_listing_id === 'string' ? o.external_listing_id : null;
    const oStatus = typeof o.listing_status === 'string' ? o.listing_status : null;
    const oTitle = typeof o.observed_title === 'string' ? o.observed_title : null;
    const oDesc = typeof o.observed_description === 'string' ? o.observed_description : null;
    const oImages = Array.isArray(o.observed_images) ? o.observed_images : null;
    const oAt = typeof o.observed_at === 'string' ? o.observed_at : new Date().toISOString();

    // Detect content drift: observed Mercari content differs from published canonical
    const canonicalTitle = typeof listing.title === 'string' ? listing.title : '';
    const canonicalDesc = typeof listing.description === 'string' ? listing.description : '';
    const drift = (oTitle && oTitle !== canonicalTitle)
      || (oDesc && oDesc !== canonicalDesc);

    try {
      const patch: Record<string, unknown> = {
        observed_title: oTitle,
        observed_description: oDesc,
        observed_images: oImages,
        observed_at: oAt,
        content_drift: Boolean(drift),
      };
      if (externalId) patch.external_listing_id = externalId;
      if (oStatus) patch.listing_status = oStatus;

      // If publish_pending with matching external identity, recover to published.
      // Only recover when a publish claim is active — prevents bypassing the claim guard.
      const storedClaimId = typeof listing.publish_claim_id === 'string'
        ? listing.publish_claim_id : null;
      const isRecovery = listing.lifecycle_stage === 'publish_pending' && externalId && storedClaimId;
      if (isRecovery) {
        const existingExtId = typeof listing.external_listing_id === 'string'
          ? listing.external_listing_id : null;
        if (!existingExtId || existingExtId === externalId) {
          patch.lifecycle_stage = 'published';
          patch.published_content_revision = listing.content_revision;
          patch.published_at = typeof listing.published_at === 'string' ? listing.published_at : oAt;
          patch.publish_idempotency_key = null;
        }
      }

      // Atomic predicates: for recovery, guard against concurrent release/transition.
      const obsFilters: string[] | undefined = isRecovery
        ? [`publish_claim_id=eq.${storedClaimId}`, 'lifecycle_stage=eq.publish_pending']
        : undefined;

      const patched = await postgrestPatch(supabaseEnv, 'platform_listings', 'id', listingId, patch, fetchFn, undefined, obsFilters);
      if (!patched && isRecovery) {
        // Another transition won the race — report as conflict, not observed.
        results.results.push({ listing_id: listingId, outcome: 'not_found', content_drift: false });
        continue;
      }
      results.results.push({ listing_id: listingId, outcome: 'observed', content_drift: Boolean(drift) });
    } catch (error) {
      console.error('observation patch failed', error);
      results.results.push({ listing_id: listingId, outcome: 'not_found', content_drift: false });
    }
  }

  return json(results);
}
