import {
  type CopyClaimAttribution,
  type CopyClaimSelection,
  type CopyProposal,
  type ListingClaimPack,
} from './types.js';

export interface RenderableCopyClaim {
  id: string;
  source: 'parent_spu' | 'selected_variant' | 'common_across_children';
  titleText: string | null;
  descriptionText: string;
}

function compactNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

function resolvedFact<T>(
  selected: T | null,
  common: T | null,
): { value: T; source: 'selected_variant' | 'common_across_children' } | null {
  if (selected !== null) return { value: selected, source: 'selected_variant' };
  if (common !== null) return { value: common, source: 'common_across_children' };
  return null;
}

export function buildRenderableCopyClaims(pack: ListingClaimPack): RenderableCopyClaim[] {
  const claims: RenderableCopyClaim[] = [];
  const productTypes = [...new Set(pack.parentSpu.productTypes)];
  if (productTypes.length > 0) {
    const [primary, ...synonyms] = productTypes;
    claims.push({
      id: 'parent.product_types',
      source: 'parent_spu',
      titleText: productTypes.join(' '),
      descriptionText: synonyms.length > 0
        ? `${primary}（${synonyms.join('／')}）です。`
        : `${primary}です。`,
    });
  }
  if (pack.parentSpu.sizes.length > 0) {
    const sizes = pack.parentSpu.sizes.join('／');
    claims.push({
      id: 'parent.sizes', source: 'parent_spu',
      titleText: `${sizes}サイズ`, descriptionText: `サイズは${sizes}です。`,
    });
  }
  if (pack.parentSpu.tripDuration) {
    claims.push({
      id: 'parent.trip_duration', source: 'parent_spu',
      titleText: `${pack.parentSpu.tripDuration}旅行`,
      descriptionText: `旅行目安は${pack.parentSpu.tripDuration}です。`,
    });
  }
  if (pack.parentSpu.features.includes('TSAロック')) {
    claims.push({
      id: 'parent.feature.tsa_lock', source: 'parent_spu',
      titleText: 'TSAロック搭載', descriptionText: 'TSAロックを搭載しています。',
    });
  }

  const selected = pack.selectedVariant.itemCode ? pack.selectedVariant : null;
  const weight = resolvedFact(selected?.weightKg ?? null, pack.commonAcrossChildren.weightKg);
  if (weight) {
    const value = compactNumber(weight.value);
    claims.push({
      id: `${weight.source}.weight_kg`, source: weight.source,
      titleText: `${value}kg`, descriptionText: `重量は${value}kgです。`,
    });
  }
  const quantity = resolvedFact(selected?.packageQuantity ?? null, pack.commonAcrossChildren.packageQuantity);
  if (quantity) {
    const value = compactNumber(quantity.value);
    claims.push({
      id: `${quantity.source}.package_quantity`, source: quantity.source,
      titleText: null, descriptionText: `内容数は${value}個です。`,
    });
  }
  const country = resolvedFact(selected?.countryOfOrigin ?? null, pack.commonAcrossChildren.countryOfOrigin);
  if (country) {
    claims.push({
      id: `${country.source}.country_of_origin`, source: country.source,
      titleText: null, descriptionText: `原産国は${country.value}です。`,
    });
  }
  const assembly = resolvedFact(selected?.assemblyStatus ?? null, pack.commonAcrossChildren.assemblyStatus);
  const isSuitcase = productTypes.some((value) => value.includes('スーツケース') || value.includes('キャリー'));
  if (assembly && !(isSuitcase && assembly.value === '要組立品')) {
    claims.push({
      id: `${assembly.source}.assembly_status`, source: assembly.source,
      titleText: null, descriptionText: `組立区分は${assembly.value}です。`,
    });
  }
  return claims;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function materializeClaimSelection(
  selection: CopyClaimSelection,
  pack: ListingClaimPack,
  confidence: number,
  rationale: string,
): { proposal: CopyProposal; errors: string[] } {
  const catalog = new Map(buildRenderableCopyClaims(pack).map((claim) => [claim.id, claim]));
  const errors: string[] = [];
  const titleIds = unique(selection.titleClaimIds);
  const descriptionIds = unique(selection.descriptionClaimIds);
  if (titleIds.length !== selection.titleClaimIds.length) errors.push('title_claim_ids must not contain duplicates');
  if (descriptionIds.length !== selection.descriptionClaimIds.length) errors.push('description_claim_ids must not contain duplicates');

  const titleClaims = titleIds.flatMap((id) => {
    const claim = catalog.get(id);
    if (!claim) { errors.push(`Unknown or unavailable title claim ID: ${id}`); return []; }
    if (!claim.titleText) { errors.push(`Claim is not allowed in the title: ${id}`); return []; }
    return [claim];
  });
  const descriptionClaims = descriptionIds.flatMap((id) => {
    const claim = catalog.get(id);
    if (!claim) { errors.push(`Unknown or unavailable description claim ID: ${id}`); return []; }
    return [claim];
  });
  const title = titleClaims.length > 0 ? titleClaims.map((claim) => claim.titleText).join(' ') : null;
  const description = descriptionClaims.length > 0
    ? descriptionClaims.map((claim) => claim.descriptionText).join('\n')
    : null;
  const claimAttributions: CopyClaimAttribution[] = [
    ...titleClaims.map((claim) => ({ target: 'title' as const, claimId: claim.id, renderedText: claim.titleText! })),
    ...descriptionClaims.map((claim) => ({ target: 'description' as const, claimId: claim.id, renderedText: claim.descriptionText })),
  ];
  return {
    proposal: {
      title, description, confidence, rationale,
      claimSelection: { titleClaimIds: titleIds, descriptionClaimIds: descriptionIds },
      claimAttributions,
    },
    errors,
  };
}

const CLEANUP_GROUPS: Array<{ id: string; terms: string[] }> = [
  { id: 'unverified_size_class', terms: ['小型', '機内持込', '機内持ち込み'] },
  { id: 'color', terms: ['ベージュ', 'ブラック', 'ホワイト', 'グレー', 'シルバー', 'レッド', 'ブルー', 'グリーン', 'ピンク'] },
  { id: 'surface', terms: ['エンボス加工'] },
  { id: 'caster', terms: ['360度', 'キャスター'] },
  { id: 'interior', terms: ['メッシュポケット'] },
  { id: 'material', terms: ['ABSPC', 'ABS樹脂', 'ABS', '樹脂'] },
];

export function findUnsupportedClaimGroups(text: string, pack?: ListingClaimPack): string[] {
  if (!pack) return [];
  const normalized = text.normalize('NFKC').toLowerCase();
  const authorized = JSON.stringify(buildRenderableCopyClaims(pack)).normalize('NFKC').toLowerCase();
  return CLEANUP_GROUPS.flatMap((group) => group.terms.some((term) => {
    const candidate = term.normalize('NFKC').toLowerCase();
    return normalized.includes(candidate) && !authorized.includes(candidate);
  }) ? [group.id] : []);
}
