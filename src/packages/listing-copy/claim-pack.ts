import { type ListingClaimPack } from './types.js';

export interface ClaimPackSource {
  productSpu?: Record<string, unknown>;
  selectedVariant?: Record<string, unknown>;
  spuVariants?: Array<Record<string, unknown>>;
  assortmentSizes: string[];
  childCount: number;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function extractTripDuration(title: string): { label: string | null; tokens: string[] } {
  const range = title.match(/(\d+)\s*(?:～|〜|~|-|－|–|—)\s*(\d+)\s*(泊|日)/);
  if (range) {
    const [, from, to, unit] = range;
    return { label: `${from}～${to}${unit}`, tokens: [`${from}${unit}`, `${to}${unit}`, `${from}～${to}${unit}`] };
  }
  const adjacent = title.match(/(\d+)\s*(泊|日)\s*(\d+)\s*\2/);
  if (adjacent) {
    const [, from, unit, to] = adjacent;
    return { label: `${from}～${to}${unit}`, tokens: [`${from}${unit}`, `${to}${unit}`, `${from}～${to}${unit}`] };
  }
  const single = title.match(/(\d+)\s*(泊|日)/);
  return single
    ? { label: `${single[1]}${single[2]}`, tokens: [`${single[1]}${single[2]}`] }
    : { label: null, tokens: [] };
}

function commonString(rows: Array<Record<string, unknown>>, field: string): string | null {
  if (rows.length === 0) return null;
  const first = nonEmptyString(rows[0]?.[field]);
  return first !== null && rows.every((row) => nonEmptyString(row[field]) === first) ? first : null;
}

function commonNumber(rows: Array<Record<string, unknown>>, field: string): number | null {
  if (rows.length === 0) return null;
  const first = finiteNumber(rows[0]?.[field]);
  return first !== null && rows.every((row) => finiteNumber(row[field]) === first) ? first : null;
}

/** Build an allowlisted evidence surface. Raw listing and sibling copy never enter this pack. */
export function buildListingClaimPack(source: ClaimPackSource): ListingClaimPack {
  const productSpu = source.productSpu ?? {};
  const variant = source.selectedVariant ?? {};
  const spuVariants = source.spuVariants ?? [];
  const title = nonEmptyString(productSpu.title) ?? '';
  const trip = extractTripDuration(title);
  const productTypes = ['スーツケース', 'キャリーケース', 'キャリーバッグ']
    .filter((term) => title.includes(term));
  const features = [title.match(/TSA\s*ロック/i) ? 'TSAロック' : null]
    .filter((value): value is string => value !== null);
  const sizes = unique(source.assortmentSizes);
  const weightKg = finiteNumber(variant.product_weight_kg);
  const packageQuantity = finiteNumber(variant.package_quantity);
  const commonWeightKg = commonNumber(spuVariants, 'product_weight_kg');
  const commonPackageQuantity = commonNumber(spuVariants, 'package_quantity');
  const groundedNumericTokens = unique([
    ...(weightKg === null && commonWeightKg === null ? [] : [`${weightKg ?? commonWeightKg}kg`]),
    ...(packageQuantity === null && commonPackageQuantity === null ? [] : [`${packageQuantity ?? commonPackageQuantity}個`]),
    ...trip.tokens,
  ]);

  return {
    parentSpu: {
      spuCode: nonEmptyString(productSpu.spu_code),
      productTypes,
      sizes,
      tripDuration: trip.label,
      features,
    },
    selectedVariant: {
      itemCode: nonEmptyString(variant.item_code),
      weightKg,
      packageQuantity,
      countryOfOrigin: nonEmptyString(variant.country_of_origin_ja),
      assemblyStatus: nonEmptyString(variant.assembly_status),
    },
    commonAcrossChildren: {
      weightKg: commonWeightKg,
      packageQuantity: commonPackageQuantity,
      countryOfOrigin: commonString(spuVariants, 'country_of_origin_ja'),
      assemblyStatus: commonString(spuVariants, 'assembly_status'),
    },
    assortment: {
      strategy: sizes.length >= 2 ? 'multi_size' : sizes.length === 1 ? 'single_size' : 'unknown',
      childCount: Math.max(0, source.childCount),
      sizes,
    },
    groundedNumericTokens,
    unsupportedOrMissing: [
      '機内持ち込み', '360度キャスター', 'エンボス加工', 'メッシュポケット',
      '超軽量・軽量設計', 'S/M/L availability outside this SPU',
      'color (selected-child mapping is ambiguous)',
    ],
  };
}
