import { supabase } from '../lib/supabase.js';
import { runReReview } from '../packages/listing-quality/review-runner.js';
import {
  type CopyMode,
  type CopyBenchmark,
  type CopyImproveConfig,
  type ListingClaimPack,
  type CopyProposal,
  type CopyProposalResult,
  type FinalizationSummary,
  type ListingRow,
  type WorkItemRow,
} from '../packages/listing-copy/types.js';
import {
  applyContentUpdate,
  buildConfig,
  callDeepSeek,
  callOllama,
  generateProposal,
  idempotencyKey,
  parseLimit,
  proposalInputIdentity,
  validateConfigForMode,
  validateProposal,
} from '../packages/listing-copy/improve-copy.js';
import { evaluateAgainstBenchmark } from '../packages/listing-copy/benchmark.js';
import {
  activateBenchmarkSet,
  captureRakutenBenchmark,
  extractSuitcaseSizes,
  persistBenchmarkSet,
  type BenchmarkCaptureResult,
} from '../packages/listing-copy/benchmark-capture.js';
import {
  assessBenchmarkCandidates,
  identifyBenchmarkScope,
  isBenchmarkReusable,
  type BenchmarkScope,
} from '../packages/listing-copy/benchmark-identification.js';
import { buildListingClaimPack } from '../packages/listing-copy/claim-pack.js';

const MAX_SELECTION_SCAN = 100;
const DEFAULT_BENCHMARK_TTL_DAYS = 30;
const DEFAULT_BENCHMARK_CAPTURE_DELAY_MS = 1_000;

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function nonNullRecord(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== null && value !== undefined && value !== ''));
}

function groundedNumericTokens(variant: Record<string, unknown> | undefined): string[] {
  if (!variant) return [];
  const tokens: string[] = [];
  for (const [field, unit] of [
    ['product_weight_kg', 'kg'], ['package_weight_kg', 'kg'],
    ['package_width_cm', 'cm'], ['package_height_cm', 'cm'], ['package_length_cm', 'cm'],
    ['package_quantity', '個'],
  ] as const) {
    const value = variant[field];
    if (typeof value === 'number' && Number.isFinite(value)) tokens.push(`${value}${unit}`);
  }
  return tokens;
}

function isWeakCopy(listing: Pick<ListingRow, 'title' | 'description'>): boolean {
  return !listing.title || [...listing.title].length < 30 ||
    !listing.description || [...listing.description].length < 120;
}

interface SelectionResult {
  listings: ListingRow[];
  requests: number;
  rowsRead: number;
}

async function fetchRakutenListings(options: {
  shopCode?: string;
  listingId?: string;
  manualSelection?: boolean;
  limit: number;
}): Promise<SelectionResult> {
  let requests = 0;
  let rowsRead = 0;
  let query = supabase
    .from('platform_listings')
    .select('id,platform,shop_code,title,description,variant_id,product_spu_id,product_family_id,category_id,category_name,content_revision')
    .eq('platform', 'rakuten')
    .in('lifecycle_stage', ['draft', 'enhanced'])
    .order('updated_at', { ascending: false })
    .limit(options.listingId ? 1 : MAX_SELECTION_SCAN);
  if (options.shopCode) query = query.eq('shop_code', options.shopCode);
  if (options.listingId) query = query.eq('id', options.listingId);

  const { data, error } = await query;
  requests++;
  if (error) throw new Error(`Fetch Rakuten listings: ${error.message}`);
  const rawListings = (data ?? []) as Array<Record<string, unknown>>;
  rowsRead += rawListings.length;
  const selected: ListingRow[] = rawListings
    .map((row) => ({
      id: String(row.id),
      platform: String(row.platform),
      shop_code: String(row.shop_code),
      title: typeof row.title === 'string' ? row.title : null,
      description: typeof row.description === 'string' ? row.description : null,
      variant_id: typeof row.variant_id === 'string' ? row.variant_id : null,
      product_spu_id: typeof row.product_spu_id === 'string' ? row.product_spu_id : null,
      product_family_id: typeof row.product_family_id === 'string' ? row.product_family_id : null,
      category_id: typeof row.category_id === 'string' ? row.category_id : null,
      category_name: typeof row.category_name === 'string' ? row.category_name : null,
      content_revision: typeof row.content_revision === 'number' ? row.content_revision : 1,
      is_hero: false,
      trusted_facts: {},
    }))
    .filter((listing) => Boolean(options.listingId) || options.manualSelection || isWeakCopy(listing))
    .slice(0, options.limit);

  if (selected.length === 0) return { listings: [], requests, rowsRead };

  const listingIds = selected.map((row) => row.id);

  const linksResult = await supabase.from('product_platform_links')
    .select('listing_id,variant_id,product_spu_id,product_family_id,confidence')
    .in('listing_id', listingIds)
    .order('confidence', { ascending: false, nullsFirst: false });
  requests++;
  if (linksResult.error) throw new Error(`Fetch product-platform links: ${linksResult.error.message}`);
  rowsRead += linksResult.data?.length ?? 0;
  const linksByListing = new Map<string, Array<Record<string, unknown>>>();
  for (const link of linksResult.data ?? []) {
    const listingId = String(link.listing_id);
    const current = linksByListing.get(listingId) ?? [];
    current.push(link as Record<string, unknown>);
    linksByListing.set(listingId, current);
  }
  for (const listing of selected) {
    const links = linksByListing.get(listing.id) ?? [];
    const variantIdsForListing = [...new Set(links.flatMap((link) => typeof link.variant_id === 'string' ? [link.variant_id] : []))];
    const spuIdsForListing = [...new Set(links.flatMap((link) => typeof link.product_spu_id === 'string' ? [link.product_spu_id] : []))];
    const familyIdsForListing = [...new Set(links.flatMap((link) => typeof link.product_family_id === 'string' ? [link.product_family_id] : []))];
    if (variantIdsForListing.length === 1) listing.variant_id ??= variantIdsForListing[0] ?? null;
    if (spuIdsForListing.length === 1) listing.product_spu_id ??= spuIdsForListing[0] ?? null;
    if (familyIdsForListing.length === 1) listing.product_family_id ??= familyIdsForListing[0] ?? null;
  }

  const variantIds = selected.flatMap((row) => row.variant_id ? [row.variant_id] : []);
  const spuIds = selected.flatMap((row) => row.product_spu_id ? [row.product_spu_id] : []);
  const familyIds = selected.flatMap((row) => row.product_family_id ? [row.product_family_id] : []);

  const [variantsResult, spuVariantsResult, spusResult, familiesResult, attributesResult, heroResult] = await Promise.all([
    variantIds.length ? supabase.from('product_variants')
      .select('id,item_code,variant_name,color,size_text,material,material_ja,country_of_origin_ja,assembly_status,package_width_cm,package_height_cm,package_length_cm,package_weight_kg,product_weight_kg,package_quantity')
      .in('id', variantIds) : Promise.resolve({ data: [], error: null }),
    spuIds.length ? supabase.from('product_variants')
      .select('id,product_spu_id,item_code,variant_name,color,size_text,product_weight_kg,package_quantity,country_of_origin_ja,assembly_status')
      .in('product_spu_id', spuIds)
      .limit(2000) : Promise.resolve({ data: [], error: null }),
    spuIds.length ? supabase.from('product_spus')
      .select('id,spu_code,title,manufacturer_model,category')
      .in('id', spuIds) : Promise.resolve({ data: [], error: null }),
    familyIds.length ? supabase.from('product_families')
      .select('id,family_name,category,brand_name')
      .in('id', familyIds) : Promise.resolve({ data: [], error: null }),
    supabase.from('platform_listing_attributes')
      .select('listing_id,attribute_key,attribute_value,attribute_unit')
      .in('listing_id', listingIds)
      .limit(2000),
    spuIds.length ? supabase.from('merchandising_focus_items')
      .select('product_spu_id')
      .in('product_spu_id', spuIds)
      .eq('focus_type', 'hero')
      .eq('status', 'active') : Promise.resolve({ data: [], error: null }),
  ]);
  requests += 6;
  for (const [label, result] of [
    ['variants', variantsResult], ['SPU variants', spuVariantsResult],
    ['SPUs', spusResult], ['families', familiesResult],
    ['attributes', attributesResult], ['hero flags', heroResult],
  ] as const) {
    if (result.error) throw new Error(`Fetch ${label}: ${result.error.message}`);
    rowsRead += result.data?.length ?? 0;
  }

  const variants = new Map((variantsResult.data ?? []).map((row: Record<string, unknown>) => [String(row.id), row]));
  const spus = new Map((spusResult.data ?? []).map((row: Record<string, unknown>) => [String(row.id), row]));
  const families = new Map((familiesResult.data ?? []).map((row: Record<string, unknown>) => [String(row.id), row]));
  const heroSpus = new Set((heroResult.data ?? []).map((row: Record<string, unknown>) => String(row.product_spu_id)));
  const variantsBySpu = new Map<string, Array<Record<string, unknown>>>();
  for (const row of spuVariantsResult.data ?? []) {
    const record = row as Record<string, unknown>;
    const key = String(record.product_spu_id);
    const current = variantsBySpu.get(key) ?? [];
    current.push(record);
    variantsBySpu.set(key, current);
  }
  const attributesByListing = new Map<string, Array<Record<string, unknown>>>();
  for (const row of attributesResult.data ?? []) {
    const record = row as Record<string, unknown>;
    if (record.attribute_value === null || record.attribute_value === undefined || record.attribute_value === '') continue;
    const key = String(record.listing_id);
    const current = attributesByListing.get(key) ?? [];
    current.push(nonNullRecord({
      key: record.attribute_key,
      value: record.attribute_value,
      unit: record.attribute_unit,
    }));
    attributesByListing.set(key, current);
  }

  for (const listing of selected) {
    listing.is_hero = listing.product_spu_id ? heroSpus.has(listing.product_spu_id) : false;
    const spu = listing.product_spu_id ? spus.get(listing.product_spu_id) : undefined;
    const spuVariants = listing.product_spu_id ? variantsBySpu.get(listing.product_spu_id) ?? [] : [];
    const assortmentSizes = [...new Set([
      ...(typeof spu?.title === 'string' ? extractSuitcaseSizes(spu.title) : []),
      ...spuVariants.flatMap((variant) => typeof variant.variant_name === 'string'
        ? extractSuitcaseSizes(variant.variant_name) : []),
    ])];
    const selectedVariant = listing.variant_id ? variants.get(listing.variant_id) : undefined;
    listing.verified_claim_pack = buildListingClaimPack({
      productSpu: spu,
      selectedVariant,
      spuVariants,
      assortmentSizes,
      childCount: spuVariants.length,
    });
    listing.trusted_facts = nonNullRecord({
      variant: selectedVariant ?? null,
      product: spu ?? null,
      family: listing.product_family_id ? families.get(listing.product_family_id) ?? null : null,
      assortment: listing.product_spu_id ? {
        parent_spu_id: listing.product_spu_id,
        strategy: assortmentSizes.length >= 2 ? 'multi_size' : assortmentSizes.length === 1
          ? 'single_size' : 'unknown',
        sizes: assortmentSizes,
        child_variant_count: spuVariants.length,
        children: spuVariants.map((variant) => nonNullRecord({
          item_code: variant.item_code,
          color: variant.color,
          size_text: variant.size_text,
        })),
      } : null,
      grounded_numeric_tokens: groundedNumericTokens(selectedVariant),
      attributes: attributesByListing.get(listing.id) ?? [],
    });
    const family = listing.product_family_id ? families.get(listing.product_family_id) : undefined;
    listing.category_name = listing.category_name ??
      (typeof spu?.category === 'string' ? spu.category : null) ??
      (typeof family?.category === 'string' ? family.category : null);
  }
  return { listings: selected, requests, rowsRead };
}

interface BenchmarkResolution {
  byListingId: Map<string, CopyBenchmark>;
  requests: number;
  rowsRead: number;
  reused: number;
  stale: number;
  identified: number;
  identificationFailed: number;
  externalRequests: number;
  rowsWritten: number;
}

function benchmarkFromRows(
  set: Record<string, unknown>,
  items: Array<Record<string, unknown>>,
): CopyBenchmark {
  const profile = set.target_profile_json && typeof set.target_profile_json === 'object'
    ? set.target_profile_json as Record<string, unknown>
    : {};
  const topics = Array.isArray(profile.description_topics) ? profile.description_topics : [];
  const assortment = profile.assortment && typeof profile.assortment === 'object'
    ? profile.assortment as Record<string, unknown>
    : {};
  return {
    id: String(set.id),
    marketplace: String(set.marketplace),
    categoryId: typeof set.category_id === 'string' ? set.category_id : null,
    categoryName: typeof set.category_name === 'string' ? set.category_name : null,
    scopeKey: String(set.scope_key),
    selectionMode: set.selection_mode === 'operator' ? 'operator' : 'automatic',
    version: Number(set.version),
    sourceKind: String(set.source_kind),
    capturedAt: String(set.captured_at),
    titleTerms: Array.isArray(profile.title_terms)
      ? profile.title_terms.filter((term): term is string => typeof term === 'string')
      : [],
    descriptionTopics: topics.flatMap((topic) => {
      if (!topic || typeof topic !== 'object') return [];
      const value = topic as Record<string, unknown>;
      if (typeof value.name !== 'string' || !Array.isArray(value.terms)) return [];
      return [{
        name: value.name,
        terms: value.terms.filter((term): term is string => typeof term === 'string'),
      }];
    }),
    assortment: {
      strategy: assortment.strategy === 'multi_size' ? 'multi_size'
        : assortment.strategy === 'single_size' ? 'single_size' : 'unknown',
      observedSizes: Array.isArray(assortment.observedSizes)
        ? assortment.observedSizes.filter((size): size is string => typeof size === 'string') : [],
      multiSizeListingCount: typeof assortment.multiSizeListingCount === 'number'
        ? assortment.multiSizeListingCount : 0,
      multiSizeListingRatio: typeof assortment.multiSizeListingRatio === 'number'
        ? assortment.multiSizeListingRatio : 0,
    },
    items: items.map((item) => ({
      externalListingId: String(item.external_listing_id),
      rankPosition: typeof item.rank_position === 'number' ? item.rank_position : null,
      title: String(item.title),
      description: typeof item.description === 'string' ? item.description : null,
      isSponsored: item.is_sponsored === true,
    })),
  };
}

async function fetchActiveBenchmarks(
  listings: ListingRow[],
  scopes: Map<string, BenchmarkScope>,
  explicitBenchmarkSetId?: string,
): Promise<BenchmarkResolution> {
  const result: BenchmarkResolution = {
    byListingId: new Map(), requests: 0, rowsRead: 0, reused: 0, stale: 0,
    identified: 0, identificationFailed: 0, externalRequests: 0, rowsWritten: 0,
  };
  if (listings.length === 0) return result;

  const setRows: Array<Record<string, unknown>> = [];
  if (explicitBenchmarkSetId) {
    const { data, error } = await supabase.from('listing_copy_benchmark_sets')
      .select('*').eq('id', explicitBenchmarkSetId).eq('status', 'active').limit(1);
    result.requests++;
    if (error) throw new Error(`Fetch designated copy benchmark: ${error.message}`);
    setRows.push(...(data ?? []) as Array<Record<string, unknown>>);
  } else {
    const scopeKeys = [...new Set([...scopes.values()].map((scope) => scope.scopeKey))];
    if (scopeKeys.length > 0) {
      const response = await supabase.from('listing_copy_benchmark_sets')
        .select('*').eq('marketplace', 'rakuten').eq('status', 'active').in('scope_key', scopeKeys);
      result.requests++;
      if (response.error) throw new Error(`Fetch active copy benchmarks: ${response.error.message}`);
      setRows.push(...(response.data ?? []) as Array<Record<string, unknown>>);
    }
  }
  const uniqueSets = [...new Map(setRows.map((row) => [String(row.id), row])).values()];
  result.rowsRead += uniqueSets.length;
  if (explicitBenchmarkSetId && uniqueSets.length === 0) {
    throw new Error(`Active designated copy benchmark not found: ${explicitBenchmarkSetId}`);
  }
  if (uniqueSets.length === 0) return result;

  const ttlDays = Number(process.env['COPY_BENCHMARK_TTL_DAYS'] ?? DEFAULT_BENCHMARK_TTL_DAYS);
  if (!Number.isFinite(ttlDays) || ttlDays <= 0) throw new Error('COPY_BENCHMARK_TTL_DAYS must be a positive number');
  const reusableSets = explicitBenchmarkSetId
    ? uniqueSets
    : uniqueSets.filter((set) => isBenchmarkReusable(
      String(set.captured_at),
      set.selection_mode === 'operator' ? 'operator' : 'automatic',
      ttlDays,
    ));
  if (reusableSets.length === 0) {
    for (const listing of listings) {
      const scope = scopes.get(listing.id);
      if (scope && uniqueSets.some((set) => String(set.scope_key) === scope.scopeKey)) result.stale++;
    }
    return result;
  }

  const { data: itemData, error: itemError } = await supabase.from('listing_copy_benchmark_items')
    .select('benchmark_set_id,external_listing_id,rank_position,title,description,is_sponsored')
    .in('benchmark_set_id', reusableSets.map((row) => String(row.id)))
    .eq('is_sponsored', false)
    .order('rank_position', { ascending: true });
  result.requests++;
  if (itemError) throw new Error(`Fetch copy benchmark items: ${itemError.message}`);
  const itemRows = (itemData ?? []) as Array<Record<string, unknown>>;
  result.rowsRead += itemRows.length;
  const benchmarks = reusableSets.map((set) => benchmarkFromRows(
    set,
    itemRows.filter((item) => String(item.benchmark_set_id) === String(set.id)),
  ));

  for (const listing of listings) {
    if (explicitBenchmarkSetId) {
      const benchmark = benchmarks[0];
      if (benchmark) result.byListingId.set(listing.id, benchmark);
      continue;
    }
    const scope = scopes.get(listing.id);
    if (!scope) continue;
    const benchmark = benchmarks.find((candidate) => candidate.marketplace === listing.platform &&
      candidate.scopeKey === scope.scopeKey &&
      (candidate.categoryId
        ? candidate.categoryId === scope.categoryId
        : candidate.categoryName === scope.categoryName));
    if (benchmark) {
      result.byListingId.set(listing.id, benchmark);
    } else if (uniqueSets.some((set) => String(set.scope_key) === scope.scopeKey)) {
      result.stale++;
    }
  }
  result.reused = result.byListingId.size;
  return result;
}

function benchmarkFromCapture(
  setId: string,
  version: number,
  capture: BenchmarkCaptureResult,
): CopyBenchmark {
  return {
    id: setId,
    marketplace: capture.marketplace,
    categoryId: capture.categoryId,
    categoryName: capture.categoryName,
    scopeKey: capture.scopeKey,
    selectionMode: 'automatic',
    version,
    sourceKind: capture.sourceKind,
    capturedAt: capture.capturedAt,
    titleTerms: capture.targetProfile.titleTerms,
    descriptionTopics: capture.targetProfile.descriptionTopics.map((topic) => ({ ...topic })),
    assortment: capture.targetProfile.assortment,
    items: capture.items.map((item) => ({
      externalListingId: item.externalListingId,
      rankPosition: item.rankPosition,
      title: item.title,
      description: null,
      isSponsored: item.isSponsored,
    })),
  };
}

async function resolveOrIdentifyBenchmarks(
  listings: ListingRow[],
  explicitBenchmarkSetId?: string,
): Promise<BenchmarkResolution> {
  const scopes = new Map<string, BenchmarkScope>();
  for (const listing of listings) {
    const scope = identifyBenchmarkScope(listing);
    if (scope) scopes.set(listing.id, scope);
  }
  const result = await fetchActiveBenchmarks(listings, scopes, explicitBenchmarkSetId);
  if (explicitBenchmarkSetId) return result;

  const missingByScope = new Map<string, { scope: BenchmarkScope; listings: ListingRow[] }>();
  for (const listing of listings) {
    if (result.byListingId.has(listing.id)) continue;
    const scope = scopes.get(listing.id);
    if (!scope) {
      result.identificationFailed++;
      continue;
    }
    const group = missingByScope.get(scope.scopeKey) ?? { scope, listings: [] };
    group.listings.push(listing);
    missingByScope.set(scope.scopeKey, group);
  }

  const delayMs = Number(process.env['COPY_BENCHMARK_CAPTURE_DELAY_MS'] ?? DEFAULT_BENCHMARK_CAPTURE_DELAY_MS);
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new Error('COPY_BENCHMARK_CAPTURE_DELAY_MS must be a non-negative number');
  }
  let captureIndex = 0;
  for (const { scope, listings: scopedListings } of missingByScope.values()) {
    if (captureIndex > 0 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    captureIndex++;
    result.externalRequests++;
    try {
      const capture = await captureRakutenBenchmark({
        query: scope.query,
        scopeKey: scope.scopeKey,
        categoryId: scope.categoryId ?? undefined,
        categoryName: scope.categoryName ?? undefined,
        limit: 10,
      });
      const quality = assessBenchmarkCandidates(capture, scope);
      if (!quality.valid) {
        throw new Error(quality.errors.join('; '));
      }
      const persisted = await persistBenchmarkSet(supabase, capture, { selectionMode: 'automatic' });
      result.requests += 3;
      await activateBenchmarkSet(supabase, persisted.setId);
      result.requests++;
      result.rowsWritten += 1 + capture.items.length;
      const benchmark = benchmarkFromCapture(persisted.setId, persisted.version, capture);
      for (const listing of scopedListings) result.byListingId.set(listing.id, benchmark);
      result.identified += scopedListings.length;
      console.log(JSON.stringify({
        event: 'copy_benchmark_identified',
        scopeKey: scope.scopeKey,
        query: scope.query,
        benchmarkId: persisted.setId,
        benchmarkVersion: persisted.version,
        quality,
        listingIds: scopedListings.map((listing) => listing.id),
      }));
    } catch (error) {
      result.identificationFailed += scopedListings.length;
      console.warn(JSON.stringify({
        event: 'copy_benchmark_identification_failed',
        scopeKey: scope.scopeKey,
        query: scope.query,
        listingIds: scopedListings.map((listing) => listing.id),
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }
  return result;
}

async function fetchWorkItems(listingIds: string[]): Promise<Map<string, WorkItemRow>> {
  const result = new Map<string, WorkItemRow>();
  if (listingIds.length === 0) return result;
  const { data, error } = await supabase
    .from('listing_work_items')
    .select('*')
    .eq('workflow_type', 'audit_existing_listing')
    .eq('target_type', 'listing')
    .in('listing_id', listingIds);
  if (error) throw new Error(`Fetch listing work items: ${error.message}`);
  for (const row of data ?? []) result.set(String(row.listing_id), row as unknown as WorkItemRow);
  return result;
}

type GeneratedProposal = Awaited<ReturnType<typeof generateProposal>>;

interface ReusableProposal {
  generated: GeneratedProposal;
  reviewId: string;
  resultId: string | null;
  runId: string | null;
}

async function fetchReusableProposals(
  listings: ListingRow[],
  config: CopyImproveConfig,
): Promise<Map<string, ReusableProposal>> {
  const result = new Map<string, ReusableProposal>();
  if (listings.length === 0) return result;
  const identityByHash = new Map(listings.map((listing) => {
    const identity = proposalInputIdentity(listing, config);
    return [identity.inputHash, { listing, ...identity }] as const;
  }));
  const { data, error } = await supabase.from('listing_qwen_reviews')
    .select('id,result_id,run_id,input_hash,output_hash,structured_output,validation_status,repair_attempts')
    .in('input_hash', [...identityByHash.keys()])
    .eq('llm_model', config.model)
    .eq('prompt_profile', config.promptProfile)
    .eq('prompt_version', config.promptVersion)
    .in('validation_status', ['valid', 'repaired'])
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Fetch reusable copy proposals: ${error.message}`);
  for (const row of data ?? []) {
    const identity = identityByHash.get(String(row.input_hash));
    if (!identity || result.has(identity.listing.id)) continue;
    const structured = row.structured_output as Record<string, unknown> | null;
    const candidate = structured?.proposal && typeof structured.proposal === 'object'
      ? structured.proposal as CopyProposal
      : structured as unknown as CopyProposal;
    if (!candidate || validateProposal(
      candidate, identity.listing.title, identity.listing.description,
      identity.listing.verified_claim_pack ?? '',
    ).length > 0) continue;
    result.set(identity.listing.id, {
      generated: {
        proposal: candidate,
        validationStatus: row.validation_status as 'valid' | 'repaired',
        validationErrors: [],
        repairAttempts: Number(row.repair_attempts ?? 0),
        prompt: identity.prompt,
        inputHash: identity.inputHash,
        outputHash: String(row.output_hash ?? ''),
        benchmarkEvaluation: identity.listing.benchmark
          ? evaluateAgainstBenchmark(identity.listing, candidate, identity.listing.benchmark)
          : null,
      },
      reviewId: String(row.id),
      resultId: typeof row.result_id === 'string' ? row.result_id : null,
      runId: typeof row.run_id === 'string' ? row.run_id : null,
    });
  }
  return result;
}

async function ensureWorkItem(
  listing: ListingRow,
  existing: WorkItemRow | undefined,
  proposal: CopyProposal,
  proposalResult: Pick<CopyProposalResult, 'inputHash' | 'outputHash' | 'validationStatus' | 'llmModel' | 'promptVersion' | 'benchmarkEvaluation'>,
): Promise<WorkItemRow> {
  const copyContext = {
    kind: 'listing_copy',
    proposal_title: proposal.title,
    proposal_description: proposal.description,
    proposal_confidence: proposal.confidence,
    proposal_rationale: proposal.rationale,
    proposal_claim_selection: proposal.claimSelection ?? null,
    proposal_claim_attributions: proposal.claimAttributions ?? null,
    proposal_hash: proposalResult.outputHash,
    validation_status: proposalResult.validationStatus,
    model: proposalResult.llmModel,
    prompt_version: proposalResult.promptVersion,
    content_revision: listing.content_revision,
    original_title: listing.title,
    original_description: listing.description,
    trusted_facts: listing.trusted_facts,
    verified_claim_pack: listing.verified_claim_pack,
    benchmark_id: listing.benchmark?.id ?? null,
    benchmark_version: listing.benchmark?.version ?? null,
    benchmark_evaluation: proposalResult.benchmarkEvaluation,
  };
  if (existing) {
    const { data, error } = await supabase.from('listing_work_items').update({
      status: 'ready_for_review',
      human_input_level: listing.is_hero ? 'expert_review_required' : 'confirm_only',
      source_context: { ...(existing.source_context ?? {}), copy_improvement: copyContext },
      source_snapshot_hash: proposalResult.inputHash,
      source_snapshot_version: listing.content_revision,
      updated_at: new Date().toISOString(),
    }).eq('id', existing.id).select('*').single();
    if (error) throw new Error(`Update listing work item: ${error.message}`);
    return data as unknown as WorkItemRow;
  }
  const { data, error } = await supabase.from('listing_work_items').insert({
    workflow_type: 'audit_existing_listing',
    issue_type: 'title_quality',
    recommended_action: 'run_qwen_review',
    target_type: 'listing',
    target_id: listing.id,
    platform: listing.platform,
    shop_code: listing.shop_code,
    product_family_id: listing.product_family_id,
    product_spu_id: listing.product_spu_id,
    variant_id: listing.variant_id,
    listing_id: listing.id,
    priority_score: 50,
    business_priority: listing.is_hero ? 'high' : 'normal',
    issue_severity: 'medium',
    is_hero: listing.is_hero,
    human_input_level: listing.is_hero ? 'expert_review_required' : 'confirm_only',
    status: 'ready_for_review',
    source_context: { copy_improvement: copyContext },
    source_snapshot_hash: proposalResult.inputHash,
    source_snapshot_version: listing.content_revision,
    classification_reasons: [{ reason: 'AI listing copy improvement proposal', check: 'listing_copy' }],
    deterministic_findings: [],
  }).select('*').single();
  if (error) throw new Error(`Create listing work item: ${error.message}`);
  return data as unknown as WorkItemRow;
}

async function persistProposal(result: CopyProposalResult, listing: ListingRow): Promise<void> {
  const llmRuntime = process.env['LISTING_COPY_PROVIDER'] ?? 'deepseek';
  const runStatus = result.validationStatus === 'failed' ? 'failed' : 'completed';
  const { data: run, error: runError } = await supabase.from('listing_intelligence_runs').insert({
    run_type: 'qwen_review',
    status: runStatus,
    work_item_id: result.workItemId || null,
    platform: listing.platform,
    shop_code: listing.shop_code,
    source_snapshot_hash: result.inputHash,
    source_snapshot_version: listing.content_revision,
    metadata: {
      kind: 'listing_copy', llm_runtime: llmRuntime, llm_model: result.llmModel,
      prompt_profile: result.promptProfile, prompt_version: result.promptVersion, mode: result.mode,
    },
    error_message: result.errorMessage ?? null,
    completed_at: new Date().toISOString(),
  }).select('id').single();
  if (runError) throw new Error(`Persist copy run: ${runError.message}`);
  result.runId = String(run.id);

  const resultStatus = result.validationStatus === 'valid' || result.validationStatus === 'repaired'
    ? 'ready' : result.validationStatus;
  const { data: intelligenceResult, error: resultError } = await supabase.from('listing_intelligence_results').insert({
    run_id: result.runId,
    work_item_id: result.workItemId || null,
    result_type: 'qwen_review',
    status: resultStatus,
    source_snapshot_hash: result.inputHash,
    source_snapshot_version: listing.content_revision,
    payload: { kind: 'listing_copy', proposal: result.proposal, benchmark_evaluation: result.benchmarkEvaluation },
    validation_status: result.validationStatus,
    validation_errors: result.validationErrors,
  }).select('id').single();
  if (resultError) throw new Error(`Persist copy result: ${resultError.message}`);
  result.resultId = String(intelligenceResult.id);

  const riskLevel = !result.proposal || result.proposal.confidence < 0.7 ? 'high'
    : result.proposal.confidence < 0.85 ? 'medium' : 'low';
  const { data: review, error: reviewError } = await supabase.from('listing_qwen_reviews').insert({
    run_id: result.runId,
    result_id: result.resultId,
    work_item_id: result.workItemId || null,
    llm_model: result.llmModel,
    llm_provider: llmRuntime === 'deepseek' ? 'deepseek' : 'local',
    llm_runtime: llmRuntime,
    prompt_profile: result.promptProfile,
    prompt_version: result.promptVersion,
    input_hash: result.inputHash,
    output_hash: result.outputHash,
    source_snapshot_hash: result.inputHash,
    source_snapshot_version: listing.content_revision,
    risk_level: riskLevel,
    confidence: result.proposal?.confidence ?? null,
    summary: result.proposal?.rationale ?? null,
    issues: [],
    recommendations: [],
    suggested_title: result.proposal?.title ?? null,
    suggested_description: result.proposal?.description ?? null,
    structured_output: { kind: 'listing_copy', proposal: result.proposal, benchmark_evaluation: result.benchmarkEvaluation },
    raw_request: {
      prompt_profile: result.promptProfile,
      prompt_version: result.promptVersion,
      benchmark_id: listing.benchmark?.id ?? null,
      benchmark_version: listing.benchmark?.version ?? null,
      verified_claim_pack: listing.verified_claim_pack ?? null,
    },
    raw_response: {},
    validation_status: result.validationStatus,
    validation_errors: result.validationErrors,
    repair_attempts: result.repairAttempts,
    error_message: result.errorMessage ?? null,
  }).select('id').single();
  if (reviewError) throw new Error(`Persist copy review: ${reviewError.message}`);
  result.reviewId = String(review.id);
  if (result.workItemId) {
    const { error } = await supabase.from('listing_work_items')
      .update({ latest_result_id: result.resultId, updated_at: new Date().toISOString() })
      .eq('id', result.workItemId);
    if (error) throw new Error(`Link copy result to work item: ${error.message}`);
  }
}

async function measureAppliedListing(listing: ListingRow): Promise<void> {
  await runReReview(
    {
      id: listing.id,
      platform: listing.platform,
      shop_code: listing.shop_code,
      product_spu_id: listing.product_spu_id,
      listing_status: 'unknown',
    },
    'title_change',
    { verbose: false },
  );
}

function requireApplyEnvironment(): { internalApiUrl: string; internalApiToken: string } {
  const internalApiUrl = process.env['INTERNAL_CATALOG_API_URL'];
  const internalApiToken = process.env['INTERNAL_CATALOG_API_TOKEN'];
  if (!internalApiUrl || !internalApiToken) {
    throw new Error('INTERNAL_CATALOG_API_URL and INTERNAL_CATALOG_API_TOKEN are required for apply');
  }
  return { internalApiUrl, internalApiToken };
}

async function applyApproved(
  limit: number,
  summary: FinalizationSummary,
  filters: { shopCode?: string; listingId?: string },
): Promise<void> {
  const { internalApiUrl, internalApiToken } = requireApplyEnvironment();
  let query = supabase.from('listing_work_items')
    .select('id,listing_id,platform,shop_code,status,source_context')
    .eq('workflow_type', 'audit_existing_listing')
    .eq('target_type', 'listing')
    .eq('status', 'approved')
    .contains('source_context', { copy_improvement: { kind: 'listing_copy' } })
    .limit(limit);
  if (filters.shopCode) query = query.eq('shop_code', filters.shopCode);
  if (filters.listingId) query = query.eq('listing_id', filters.listingId);
  const { data, error } = await query;
  summary.requestCount++;
  if (error) throw new Error(`Fetch approved copy proposals: ${error.message}`);
  summary.selected = data?.length ?? 0;
  summary.rowCount += data?.length ?? 0;

  for (const row of data ?? []) {
    const context = (row.source_context as Record<string, unknown>)?.copy_improvement as Record<string, unknown> | undefined;
    const proposal: CopyProposal = {
      title: typeof context?.proposal_title === 'string' ? context.proposal_title : null,
      description: typeof context?.proposal_description === 'string' ? context.proposal_description : null,
      confidence: typeof context?.proposal_confidence === 'number' ? context.proposal_confidence : 0,
      rationale: typeof context?.proposal_rationale === 'string' ? context.proposal_rationale : '',
      ...(context?.proposal_claim_selection && typeof context.proposal_claim_selection === 'object'
        ? { claimSelection: context.proposal_claim_selection as CopyProposal['claimSelection'] }
        : {}),
      ...(Array.isArray(context?.proposal_claim_attributions)
        ? { claimAttributions: context.proposal_claim_attributions as NonNullable<CopyProposal['claimAttributions']> }
        : {}),
    };
    const originalTitle = typeof context?.original_title === 'string' ? context.original_title : null;
    const originalDescription = typeof context?.original_description === 'string' ? context.original_description : null;
    const claimPack = context?.verified_claim_pack && typeof context.verified_claim_pack === 'object'
      ? context.verified_claim_pack as ListingClaimPack : '';
    if (validateProposal(proposal, originalTitle, originalDescription, claimPack).length > 0) {
      summary.stale++;
      continue;
    }
    const revision = typeof context?.content_revision === 'number' ? context.content_revision : null;
    const proposalHash = typeof context?.proposal_hash === 'string' ? context.proposal_hash : null;
    if (revision === null || !proposalHash || typeof row.listing_id !== 'string') {
      summary.stale++;
      continue;
    }
    const outcome = await applyContentUpdate({
      listingId: row.listing_id,
      title: proposal.title,
      description: proposal.description,
      expectedRevision: revision,
      idempotencyKey: idempotencyKey(row.listing_id, proposalHash),
      model: typeof context?.model === 'string' ? context.model : 'unknown',
      promptVersion: typeof context?.prompt_version === 'string' ? context.prompt_version : 'unknown',
    }, internalApiUrl, internalApiToken, fetch);
    summary.requestCount++;
    if (outcome.outcome === 'updated' || outcome.outcome === 'replay') {
      summary.approvedApplied++;
      const { error: closeError } = await supabase.from('listing_work_items').update({
        status: 'closed',
        updated_at: new Date().toISOString(),
        source_context: {
          ...(row.source_context as Record<string, unknown>),
          copy_application: {
            outcome: outcome.outcome,
            content_revision: outcome.contentRevision,
            applied_at: new Date().toISOString(),
          },
        },
      }).eq('id', row.id);
      summary.requestCount++;
      if (closeError) summary.failed++;
      try {
        await measureAppliedListing({
          id: row.listing_id,
          platform: String(row.platform), shop_code: String(row.shop_code),
          title: proposal.title, description: proposal.description,
          variant_id: null, product_spu_id: null, product_family_id: null,
          category_id: null, category_name: null,
          content_revision: outcome.contentRevision ?? revision + 1,
          is_hero: false, trusted_facts: {},
        });
      } catch {
        summary.measurementFailed++;
      }
    } else if (outcome.outcome === 'stale_revision') summary.stale++;
    else summary.failed++;
  }
}

async function main(): Promise<void> {
  const provider = process.env['LISTING_COPY_PROVIDER'] ?? 'deepseek';
  if (provider !== 'ollama' && provider !== 'deepseek') {
    throw new Error('LISTING_COPY_PROVIDER must be ollama or deepseek');
  }
  const mode = (argValue('mode') ?? process.env['COPY_APPLY_MODE'] ?? 'dry_run') as CopyMode;
  if (!['dry_run', 'approval', 'auto'].includes(mode)) throw new Error('mode must be dry_run, approval, or auto');
  const limit = parseLimit(argValue('limit'));
  const applyingApproved = hasFlag('apply-approved');
  const config = buildConfig();
  if (provider === 'deepseek' && !process.env['DEEPSEEK_API_KEY']) {
    throw new Error('DEEPSEEK_API_KEY is required for the deepseek provider');
  }
  const modelCall = provider === 'deepseek'
    ? (prompt: string, model: string) => callDeepSeek(
      prompt, model, process.env['DEEPSEEK_API_KEY'] ?? '',
    )
    : (prompt: string, model: string) => callOllama(prompt, model, config.ollamaUrl);
  const configError = validateConfigForMode(config, applyingApproved ? 'approval' : mode);
  if (configError) throw new Error(configError);
  if (mode === 'auto' || applyingApproved) requireApplyEnvironment();

  const startedAt = Date.now();
  const summary: FinalizationSummary = {
    selected: 0, proposed: 0, valid: 0, invalid: 0, autoApplied: 0,
    awaitingApproval: 0, approvedApplied: 0, stale: 0, failed: 0,
    measurementFailed: 0, requestCount: 0, rowCount: 0, runtimeMs: 0,
    benchmarked: 0, missingBenchmark: 0, benchmarkImproved: 0, benchmarkNotImproved: 0,
    benchmarkReused: 0, benchmarkStale: 0, benchmarkIdentified: 0,
    benchmarkIdentificationFailed: 0, benchmarkExternalRequests: 0, benchmarkRowsWritten: 0,
  };
  try {
    if (applyingApproved) {
      await applyApproved(limit, summary, {
        shopCode: argValue('shop-code'), listingId: argValue('listing-id'),
      });
    } else {
      const selection = await fetchRakutenListings({
        shopCode: argValue('shop-code'), listingId: argValue('listing-id'),
        manualSelection: hasFlag('manual-selection'), limit,
      });
      summary.selected = selection.listings.length;
      summary.requestCount += selection.requests;
      summary.rowCount += selection.rowsRead;
      const benchmarks = await resolveOrIdentifyBenchmarks(selection.listings, argValue('benchmark-set-id'));
      summary.requestCount += benchmarks.requests;
      summary.rowCount += benchmarks.rowsRead;
      summary.benchmarkReused += benchmarks.reused;
      summary.benchmarkStale += benchmarks.stale;
      summary.benchmarkIdentified += benchmarks.identified;
      summary.benchmarkIdentificationFailed += benchmarks.identificationFailed;
      summary.benchmarkExternalRequests += benchmarks.externalRequests;
      summary.benchmarkRowsWritten += benchmarks.rowsWritten;
      for (const listing of selection.listings) {
        listing.benchmark = benchmarks.byListingId.get(listing.id);
        if (listing.benchmark) summary.benchmarked++;
        else summary.missingBenchmark++;
        console.log(JSON.stringify({
          event: 'copy_benchmark_resolution',
          listingId: listing.id,
          categoryId: listing.category_id,
          categoryName: listing.category_name,
          benchmarkId: listing.benchmark?.id ?? null,
          benchmarkVersion: listing.benchmark?.version ?? null,
          benchmarkScopeKey: listing.benchmark?.scopeKey ?? null,
          benchmarkSelectionMode: listing.benchmark?.selectionMode ?? null,
        }));
      }
      const workItems = await fetchWorkItems(selection.listings.map((listing) => listing.id));
      summary.requestCount++;
      const reusableProposals = await fetchReusableProposals(selection.listings, config);
      summary.requestCount++;

      for (const listing of selection.listings) {
        const reusable = reusableProposals.get(listing.id);
        const generated = reusable?.generated ?? await generateProposal(listing, config, modelCall);
        if (!reusable) summary.requestCount++;
        if (generated.proposal) summary.proposed++;
        if (generated.benchmarkEvaluation?.scoreDelta && generated.benchmarkEvaluation.scoreDelta > 0) {
          summary.benchmarkImproved++;
        } else if (listing.benchmark) {
          summary.benchmarkNotImproved++;
        }
        if (generated.validationStatus === 'valid' || generated.validationStatus === 'repaired') summary.valid++;
        else if (generated.validationStatus === 'invalid') summary.invalid++;
        else summary.failed++;

        console.log(JSON.stringify({
          event: 'copy_proposal_result',
          listingId: listing.id,
          validationStatus: generated.validationStatus,
          validationErrors: generated.validationErrors,
          repairAttempts: generated.repairAttempts,
          reused: Boolean(reusable),
          modelProvider: config.provider,
          model: config.model,
          promptVersion: config.promptVersion,
          benchmarkEvaluation: generated.benchmarkEvaluation,
          before: { title: listing.title, description: listing.description },
          proposed: generated.proposal,
        }));

        const proposalResult: CopyProposalResult = {
          listingId: listing.id, workItemId: workItems.get(listing.id)?.id ?? '',
          shopCode: listing.shop_code, platform: listing.platform, isHero: listing.is_hero,
          mode, proposal: generated.proposal, validationStatus: generated.validationStatus,
          validationErrors: generated.validationErrors, repairAttempts: generated.repairAttempts,
          llmModel: config.model, promptProfile: config.promptProfile, promptVersion: config.promptVersion,
          inputHash: generated.inputHash, outputHash: generated.outputHash,
          benchmarkEvaluation: generated.benchmarkEvaluation,
          reviewId: reusable?.reviewId ?? null,
          resultId: reusable?.resultId ?? null,
          runId: reusable?.runId ?? null,
          autoApplied: false,
        };

        const valid = generated.proposal &&
          (generated.validationStatus === 'valid' || generated.validationStatus === 'repaired');
        const canAutoApply = mode === 'auto' && generated.validationStatus === 'valid' &&
          Boolean(generated.proposal) && generated.proposal!.confidence >= config.confidenceThreshold &&
          Boolean(generated.benchmarkEvaluation) &&
          Boolean(listing.benchmark?.descriptionTopics.some((topic) => topic.terms.length > 0)) &&
          !listing.is_hero && config.autoShops.has(listing.shop_code);

        if (valid && (mode === 'approval' || (mode === 'auto' && !canAutoApply))) {
          const workItem = await ensureWorkItem(listing, workItems.get(listing.id), generated.proposal!, proposalResult);
          proposalResult.workItemId = workItem.id;
          workItems.set(listing.id, workItem);
          summary.requestCount++;
          summary.awaitingApproval++;
        }

        if (!reusable) {
          await persistProposal(proposalResult, listing);
          summary.requestCount += proposalResult.workItemId ? 4 : 3;
        } else if (proposalResult.workItemId && proposalResult.resultId) {
          const { error } = await supabase.from('listing_work_items')
            .update({ latest_result_id: proposalResult.resultId, updated_at: new Date().toISOString() })
            .eq('id', proposalResult.workItemId);
          summary.requestCount++;
          if (error) throw new Error(`Link reusable copy result: ${error.message}`);
        }

        if (canAutoApply) {
          const { internalApiUrl, internalApiToken } = requireApplyEnvironment();
          const outcome = await applyContentUpdate({
            listingId: listing.id,
            title: generated.proposal!.title,
            description: generated.proposal!.description,
            expectedRevision: listing.content_revision,
            idempotencyKey: idempotencyKey(listing.id, generated.outputHash),
            model: config.model,
            promptVersion: config.promptVersion,
          }, internalApiUrl, internalApiToken, fetch);
          summary.requestCount++;
          if (outcome.outcome === 'updated' || outcome.outcome === 'replay') {
            summary.autoApplied++;
            proposalResult.autoApplied = true;
            if (proposalResult.reviewId) {
              const { error } = await supabase.from('listing_qwen_reviews').update({
                structured_output: {
                  kind: 'listing_copy', proposal: proposalResult.proposal,
                  auto_applied: true, apply_outcome: outcome.outcome,
                  applied_content_revision: outcome.contentRevision,
                },
              }).eq('id', proposalResult.reviewId);
              summary.requestCount++;
              if (error) summary.failed++;
            }
            try { await measureAppliedListing(listing); } catch { summary.measurementFailed++; }
          } else if (outcome.outcome === 'stale_revision') summary.stale++;
          else summary.failed++;
        }
      }
    }
  } catch (error) {
    summary.error = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
  } finally {
    summary.runtimeMs = Date.now() - startedAt;
    console.log(JSON.stringify(summary, null, 2));
    if (summary.failed > 0) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
