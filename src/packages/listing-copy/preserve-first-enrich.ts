import { type CommercialQualityEvaluation } from './commercial-score.js';

export type StandardCopySection =
  | 'overview'
  | 'features'
  | 'specifications'
  | 'use_cases'
  | 'care_and_cautions';

export interface SpecificationConflict {
  label: string;
  sourceValues: string[];
  enrichmentValue: string;
}

export interface PreserveFirstEnrichmentEvaluation {
  strategy: 'preserve_first_structured_enrich_v2';
  sourcePreserved: boolean;
  sourceBlockCount: number;
  missingSourceBlocks: string[];
  specificationConflicts: SpecificationConflict[];
  addedDecisionFactors: string[];
  addedDifferentiators: string[];
  hasSubstantiveCommercialGain: boolean;
}

const SECTION_ORDER: StandardCopySection[] = [
  'overview', 'features', 'specifications', 'use_cases', 'care_and_cautions',
];

const SECTION_TITLES: Record<StandardCopySection, string> = {
  overview: '商品概要',
  features: '特徴・ベネフィット',
  specifications: '商品仕様',
  use_cases: '使用シーン・おすすめ',
  care_and_cautions: 'お手入れ・注意事項',
};

type SectionContent = Record<StandardCopySection, string[]>;

function emptySections(): SectionContent {
  return {
    overview: [], features: [], specifications: [], use_cases: [], care_and_cautions: [],
  };
}

function difference(after: string[], before: string[]): string[] {
  const existing = new Set(before);
  return after.filter((value) => !existing.has(value));
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[\s　|・:：,【】「」『』()（）]/g, '');
}

export function visibleListingText(value: string): string {
  return value.replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n・')
    .replace(/<\/(?:p|div|li|h[1-6]|ul|ol|table)>/gi, '\n')
    .replace(/<\/(?:td|th)>/gi, ' | ')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function classifyHeading(line: string): { section: StandardCopySection; retain: boolean } | null {
  const trimmed = line.trim().replace(/^#+\s*/, '');
  const bracketed = trimmed.match(/^[【［\[]([^】］\]]+)[】］\]]$/);
  if (!bracketed && (trimmed.length > 24 || /[。:：]/.test(trimmed) || /^[・●■\-]/.test(trimmed))) {
    return null;
  }
  const heading = normalize(bracketed?.[1] ?? trimmed);
  if (!heading || heading.length > 30) return null;
  if (/^(商品概要|商品説明|概要|イントロ)$/.test(heading)) return { section: 'overview', retain: false };
  if (/^(商品仕様|商品スペック|スペック)$/.test(heading)) return { section: 'specifications', retain: false };
  if (/^(使用シーンおすすめ|おすすめの使用シーン|こんな方におすすめ|対応シーン)$/.test(heading)) {
    return { section: 'use_cases', retain: false };
  }
  if (/^(お手入れ注意事項|品質お手入れについて)$/.test(heading)) {
    return { section: 'care_and_cautions', retain: false };
  }
  if (/^(特徴ベネフィット|特徴|特長|注目のポイント)$/.test(heading)) {
    return { section: 'features', retain: false };
  }
  if (/サイズ重量|素材構造|梱包情報/.test(heading)) return { section: 'specifications', retain: true };
  if (/使用シーン|多用途/.test(heading)) return { section: 'use_cases', retain: true };
  if (/お手入れ|注意事項|ご注意|品質|保証/.test(heading)) return { section: 'care_and_cautions', retain: true };
  if (/特徴|特長|ポイント|機能|モード|設計|収納|キャスター|ハンドル|安全|快適/.test(heading)) {
    return { section: 'features', retain: true };
  }
  return null;
}

function parseSections(value: string): SectionContent {
  const sections = emptySections();
  let current: StandardCopySection = 'overview';
  for (const rawLine of visibleListingText(value).split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = classifyHeading(line);
    if (heading) {
      current = heading.section;
      if (heading.retain) sections[current].push(line);
      continue;
    }
    sections[current].push(line);
  }
  return sections;
}

function uniqueLines(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalize(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sourceBlocks(value: string): string[] {
  const sections = parseSections(value);
  return SECTION_ORDER.flatMap((section) => uniqueLines(sections[section]));
}

function specificationFacts(lines: string[]): Map<string, string[]> {
  const facts = new Map<string, string[]>();
  for (const raw of lines) {
    const line = raw.replace(/^[・●■\-]\s*/, '').trim();
    const cells = line.split('|').map((cell) => cell.trim()).filter(Boolean);
    let label = '';
    let value = '';
    if (cells.length >= 2) {
      [label, value] = [cells[0]!, cells[cells.length - 1]!];
    } else {
      const match = line.match(/^([^:：]{1,20})[:：]\s*(.+)$/);
      if (match) [, label, value] = match;
    }
    if (!label || !value || /商品詳細をご確認|ご参照ください/.test(value)) continue;
    const key = normalize(label);
    const current = facts.get(key) ?? [];
    if (!current.some((existing) => normalize(existing) === normalize(value))) current.push(value);
    facts.set(key, current);
  }
  return facts;
}

function normalizedSpecificationValue(label: string, value: string): string {
  const normalizedLabel = normalize(label);
  const normalizedValue = normalize(value);
  return normalizedValue.startsWith(normalizedLabel)
    ? normalizedValue.slice(normalizedLabel.length)
    : normalizedValue;
}

function detectSpecificationConflicts(source: SectionContent, addition: SectionContent): SpecificationConflict[] {
  const before = specificationFacts(source.specifications);
  const after = specificationFacts(addition.specifications);
  const conflicts: SpecificationConflict[] = [];
  for (const [label, values] of after) {
    const sourceValues = before.get(label) ?? [];
    for (const enrichmentValue of values) {
      const enrichmentComparable = normalizedSpecificationValue(label, enrichmentValue);
      const different = sourceValues.filter((value) =>
        normalizedSpecificationValue(label, value) !== enrichmentComparable,
      );
      if (different.length > 0) conflicts.push({ label, sourceValues: different, enrichmentValue });
    }
  }
  return conflicts;
}

export function composeStructuredEnrichmentDescription(
  sourceDescription: string,
  enrichment: string,
): { description: string; specificationConflicts: SpecificationConflict[] } {
  const source = parseSections(sourceDescription);
  const addition = parseSections(enrichment);
  const sections = SECTION_ORDER.map((section) => {
    const content = uniqueLines([...source[section], ...addition[section]]);
    return `【${SECTION_TITLES[section]}】\n${content.join('\n')}`;
  });
  return {
    description: sections.join('\n\n').trim(),
    specificationConflicts: detectSpecificationConflicts(source, addition),
  };
}

export function evaluatePreserveFirstEnrichment(input: {
  sourceDescription: string;
  proposedDescription: string;
  specificationConflicts?: SpecificationConflict[];
  beforeScore: CommercialQualityEvaluation;
  proposedScore: CommercialQualityEvaluation;
}): PreserveFirstEnrichmentEvaluation {
  const blocks = sourceBlocks(input.sourceDescription);
  const proposed = normalize(input.proposedDescription);
  const missingSourceBlocks = blocks.filter((block) => !proposed.includes(normalize(block)));
  const addedDecisionFactors = difference(
    input.proposedScore.matchedDecisionFactors,
    input.beforeScore.matchedDecisionFactors,
  );
  const addedDifferentiators = difference(
    input.proposedScore.matchedDifferentiators,
    input.beforeScore.matchedDifferentiators,
  );
  const specificationConflicts = input.specificationConflicts ?? [];
  const sourcePreserved = blocks.length > 0 && missingSourceBlocks.length === 0;
  return {
    strategy: 'preserve_first_structured_enrich_v2',
    sourcePreserved,
    sourceBlockCount: blocks.length,
    missingSourceBlocks,
    specificationConflicts,
    addedDecisionFactors,
    addedDifferentiators,
    hasSubstantiveCommercialGain: sourcePreserved && specificationConflicts.length === 0 &&
      (addedDecisionFactors.length > 0 || addedDifferentiators.length > 0),
  };
}
