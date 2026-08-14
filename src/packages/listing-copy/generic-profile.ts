import { createHash } from 'node:crypto';

import {
  evaluateCommercialQuality,
  type CategoryCommercialProfile,
  type CommercialQualityEvaluation,
} from './commercial-score.js';

export type GenericEvidenceKind =
  | 'identity' | 'variant' | 'dimension' | 'weight' | 'material'
  | 'component' | 'feature' | 'origin' | 'assembly' | 'quantity' | 'specification';

export interface GenericEvidenceFact {
  id: string;
  kind: GenericEvidenceKind;
  label: string;
  value: string;
  sourceKind: 'product_spu' | 'variant_consensus' | 'supplier_payload';
  sourceRef: string;
  applicability: 'parent_spu';
  confidence: number;
  titleEligible: boolean;
}

export interface GenericCopyProfile {
  profileVersion: 'generic-v1';
  categoryId: string | null;
  categoryName: string | null;
  productIdentity: string;
  evidenceFacts: GenericEvidenceFact[];
  commercialProfile: CategoryCommercialProfile;
}

const RAW_FACT_FIELDS: Array<{
  keys: string[];
  kind: GenericEvidenceKind;
  label: string;
  titleEligible: boolean;
}> = [
  { keys: ['product-short-name', 'product_short_name'], kind: 'identity', label: '商品種別', titleEligible: true },
  { keys: ['main_material'], kind: 'material', label: '主素材', titleEligible: true },
  { keys: ['representative_color_ja', 'main_color'], kind: 'variant', label: 'カラー', titleEligible: true },
  { keys: ['product_weight_kg'], kind: 'weight', label: '商品重量kg', titleEligible: true },
  { keys: ['assembled_size-height_cm'], kind: 'dimension', label: '組立時高さcm', titleEligible: false },
  { keys: ['assembled_size-width_cm'], kind: 'dimension', label: '組立時幅cm', titleEligible: false },
  { keys: ['assembled_size-length_cm'], kind: 'dimension', label: '組立時奥行cm', titleEligible: false },
  { keys: ['package_size-height_cm'], kind: 'dimension', label: '梱包高さcm', titleEligible: false },
  { keys: ['package_size-width_cm'], kind: 'dimension', label: '梱包幅cm', titleEligible: false },
  { keys: ['package_size-length_cm'], kind: 'dimension', label: '梱包奥行cm', titleEligible: false },
  { keys: ['package_size-weight_kg'], kind: 'weight', label: '梱包重量kg', titleEligible: false },
  { keys: ['package_quantity'], kind: 'quantity', label: '入数', titleEligible: false },
  { keys: ['country_of_origin_ja'], kind: 'origin', label: '原産国', titleEligible: false },
  { keys: ['assembly_status'], kind: 'assembly', label: '組立区分', titleEligible: false },
  { keys: ['耐荷重'], kind: 'specification', label: '耐荷重', titleEligible: true },
  { keys: ['features_from_images'], kind: 'feature', label: '画像確認済み特徴', titleEligible: true },
  { keys: ['product_features'], kind: 'feature', label: '仕入先商品特徴', titleEligible: true },
  { keys: ['product_specification'], kind: 'specification', label: '仕入先商品仕様', titleEligible: false },
];

function text(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, 5000) : null;
}

function commonRawValue(rows: Array<Record<string, unknown>>, keys: string[]): { key: string; value: string } | null {
  if (rows.length === 0) return null;
  for (const key of keys) {
    const values = rows.map((row) => {
      const raw = row.raw_payload;
      return raw && typeof raw === 'object' && !Array.isArray(raw)
        ? text((raw as Record<string, unknown>)[key]) : null;
    });
    if (values[0] && values.every((value) => value === values[0])) {
      return { key, value: values[0] };
    }
  }
  return null;
}

function factId(kind: string, sourceRef: string, value: string): string {
  return `${kind}.${createHash('sha256').update(`${sourceRef}:${value}`).digest('hex').slice(0, 12)}`;
}

function uniqueFacts(facts: GenericEvidenceFact[]): GenericEvidenceFact[] {
  const seen = new Set<string>();
  return facts.filter((fact) => {
    const key = `${fact.kind}:${fact.value.normalize('NFKC').toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function titleTokens(value: string): string[] {
  const stop = new Set(['新品', 'おしゃれ', '人気', 'おすすめ', '送料無料', '高級']);
  return [...new Set(value.normalize('NFKC').split(/[\s　／/・,，、【】［］()（）]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && token.length <= 24 && !stop.has(token)))]
    .slice(0, 10);
}

function evidenceTerms(value: string): string[] {
  if ([...value].length <= 48) return [value];
  const bracketed = Array.from(value.matchAll(/【([^】]{2,24})】/g)).map((match) => match[1]!);
  const numeric = value.match(/\d+(?:\.\d+)?\s?(?:cm|mm|kg|g|L|ml|個|枚|台|段|人|歳)/gi) ?? [];
  const phrases = value.split(/[。\n]/).map((part) => part.replace(/^[・\d.\s]+/, '').trim())
    .filter((part) => [...part].length >= 2 && [...part].length <= 32);
  return [...new Set([...bracketed, ...numeric, ...phrases])].slice(0, 8);
}

export function buildGenericEvidenceFacts(source: {
  productSpu: Record<string, unknown>;
  spuVariants: Array<Record<string, unknown>>;
}): GenericEvidenceFact[] {
  const facts: GenericEvidenceFact[] = [];
  const spuCode = text(source.productSpu.spu_code) ?? 'unknown-spu';
  const identity = text(source.productSpu.title);
  if (identity) {
    facts.push({
      id: factId('identity', `product_spus.${spuCode}.title`, identity),
      kind: 'identity', label: '商品マスター名', value: identity,
      sourceKind: 'product_spu', sourceRef: `product_spus:${spuCode}:title`,
      applicability: 'parent_spu', confidence: 0.9, titleEligible: true,
    });
  }

  for (const field of RAW_FACT_FIELDS) {
    const common = commonRawValue(source.spuVariants, field.keys);
    if (!common) continue;
    const sourceRef = `product_variants.raw_payload:${spuCode}:${common.key}:consensus-${source.spuVariants.length}`;
    facts.push({
      id: factId(field.kind, sourceRef, common.value), kind: field.kind,
      label: field.label, value: common.value, sourceKind: 'variant_consensus',
      sourceRef, applicability: 'parent_spu', confidence: 0.9,
      titleEligible: field.titleEligible,
    });
  }
  return uniqueFacts(facts);
}

export function buildGenericCopyProfile(input: {
  categoryId: string | null;
  categoryName: string | null;
  productSpu: Record<string, unknown>;
  spuVariants: Array<Record<string, unknown>>;
  benchmarkTerms?: string[];
}): GenericCopyProfile {
  const evidenceFacts = buildGenericEvidenceFacts(input);
  const identity = evidenceFacts.find((fact) => fact.kind === 'identity')?.value ?? '商品';
  const identityTerms = titleTokens(identity);
  const benchmarkTerms = [...new Set((input.benchmarkTerms ?? []).filter((term) => term.trim().length >= 2))];
  const decisionFacts = evidenceFacts.filter((fact) => fact.kind !== 'identity').slice(0, 12);
  const differentiators = evidenceFacts.filter((fact) =>
    ['material', 'component', 'feature', 'specification'].includes(fact.kind),
  ).slice(0, 8);
  return {
    profileVersion: 'generic-v1', categoryId: input.categoryId,
    categoryName: input.categoryName, productIdentity: identity, evidenceFacts,
    commercialProfile: {
      decisionFactors: [
        { id: 'identity', terms: identityTerms.slice(0, 3) },
        ...decisionFacts.map((fact) => ({ id: fact.id, terms: evidenceTerms(fact.value) })),
      ].filter((factor) => factor.terms.length > 0),
      titleTerms: [...identityTerms, ...benchmarkTerms].slice(0, 12)
        .map((term) => ({ id: `title.${term}`, terms: [term] })),
      differentiators: differentiators.map((fact) => ({ id: fact.id, terms: evidenceTerms(fact.value) })),
      preferredTitleLength: { min: 28, max: 110 },
      preferredDescriptionLength: { min: 120, max: 1400 },
      productTypeTerms: identityTerms.slice(0, 3),
    },
  };
}

export function evaluateGenericCommercialQuality(
  copy: { title: string; description: string }, profile: GenericCopyProfile,
): CommercialQualityEvaluation {
  return evaluateCommercialQuality(copy, profile.commercialProfile);
}

export function validateHardClaimAttributions(
  claims: Array<{ text: string; evidenceIds: string[] }>, profile: GenericCopyProfile,
): string[] {
  const evidenceIds = new Set(profile.evidenceFacts.map((fact) => fact.id));
  const errors: string[] = [];
  for (const claim of claims) {
    if (!claim.text.trim()) errors.push('hard claim text must not be blank');
    if (claim.evidenceIds.length === 0) errors.push(`hard claim has no evidence: ${claim.text}`);
    for (const id of claim.evidenceIds) {
      if (!evidenceIds.has(id)) errors.push(`hard claim references unknown evidence ID: ${id}`);
    }
  }
  return errors;
}

export function genericEvidenceValidationText(profile: GenericCopyProfile): string {
  return profile.evidenceFacts.flatMap((fact) => {
    const value = fact.value.replace(/\d+(?:\.\d+)?/g, (number) => {
      const parsed = Number(number);
      return Number.isFinite(parsed) ? String(parsed) : number;
    });
    const unit = fact.label.endsWith('cm') ? 'cm'
      : fact.label.endsWith('kg') ? 'kg'
        : fact.label === '入数' ? '個' : '';
    const numericAliases = Array.from(fact.value.matchAll(/(\d+(?:\.\d+)?)\s*(cm|mm|kg|g|L|ml|個|枚|台|段階|日|泊)/gi))
      .map((match) => `${Number(match[1])}${match[2]}`);
    return [`${fact.label}: ${value}${unit}`, ...numericAliases];
  }).join('\n');
}
