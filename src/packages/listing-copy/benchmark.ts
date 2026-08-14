import {
  type CopyBenchmark,
  type CopyBenchmarkEvaluation,
  type CopyProposal,
  type ListingRow,
} from './types.js';
import { findUnsupportedClaimGroups } from './claim-attribution.js';

function normalizedText(value: string | null): string {
  return (value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

function coverage(text: string, terms: string[]): number {
  const usable = [...new Set(terms.map(normalizedText).filter((term) => term.length >= 2))];
  if (usable.length === 0) return 0;
  const matched = usable.filter((term) => text.includes(term)).length;
  return Math.round((matched / usable.length) * 100);
}

function topicCoverage(text: string, benchmark: CopyBenchmark): number {
  const topics = benchmark.descriptionTopics.filter((topic) => topic.terms.length > 0);
  if (topics.length === 0) return 0;
  const matched = topics.filter((topic) =>
    topic.terms.some((term) => text.includes(normalizedText(term))),
  ).length;
  return Math.round((matched / topics.length) * 100);
}

function aggregateScore(titleCoverage: number, descriptionCoverage: number, benchmark: CopyBenchmark): number {
  const hasTitleTarget = benchmark.titleTerms.length > 0;
  const hasDescriptionTarget = benchmark.descriptionTopics.some((topic) => topic.terms.length > 0);
  if (hasTitleTarget && hasDescriptionTarget) {
    return Math.round(titleCoverage * 0.45 + descriptionCoverage * 0.55);
  }
  if (hasTitleTarget) return titleCoverage;
  if (hasDescriptionTarget) return descriptionCoverage;
  return 0;
}

export function evaluateAgainstBenchmark(
  listing: Pick<ListingRow, 'title' | 'description' | 'verified_claim_pack'>,
  proposal: CopyProposal,
  benchmark: CopyBenchmark,
): CopyBenchmarkEvaluation | null {
  const hasTargets = benchmark.titleTerms.length > 0 ||
    benchmark.descriptionTopics.some((topic) => topic.terms.length > 0);
  if (!hasTargets) return null;

  const beforeTitle = normalizedText(listing.title);
  const beforeDescription = normalizedText(listing.description);
  const proposedTitle = normalizedText(proposal.title ?? listing.title);
  const proposedDescription = normalizedText(proposal.description ?? listing.description);

  const beforeTitleCoverage = coverage(beforeTitle, benchmark.titleTerms);
  const proposedTitleCoverage = coverage(proposedTitle, benchmark.titleTerms);
  const beforeDescriptionCoverage = topicCoverage(beforeDescription, benchmark);
  const proposedDescriptionCoverage = topicCoverage(proposedDescription, benchmark);
  const beforeBenchmarkScore = aggregateScore(beforeTitleCoverage, beforeDescriptionCoverage, benchmark);
  const proposedBenchmarkScore = aggregateScore(proposedTitleCoverage, proposedDescriptionCoverage, benchmark);
  const beforeUnsupported = findUnsupportedClaimGroups(
    `${listing.title ?? ''}\n${listing.description ?? ''}`,
    listing.verified_claim_pack,
  );
  const proposedUnsupported = findUnsupportedClaimGroups(
    `${proposal.title ?? listing.title ?? ''}\n${proposal.description ?? listing.description ?? ''}`,
    listing.verified_claim_pack,
  );
  const unsupportedClaimsRemoved = Math.max(0, beforeUnsupported.length - proposedUnsupported.length);
  // Commercial quality and claim safety are intentionally separate axes.
  // Unsupported-claim cleanup cannot make commercially unchanged copy score higher.
  const beforeScore = beforeBenchmarkScore;
  const proposedScore = proposedBenchmarkScore;
  const regressions: string[] = [];
  if (proposedTitleCoverage < beforeTitleCoverage) {
    regressions.push('benchmark title coverage decreased');
  }
  if (proposedDescriptionCoverage < beforeDescriptionCoverage) {
    regressions.push('benchmark description coverage decreased');
  }

  return {
    benchmarkId: benchmark.id,
    benchmarkVersion: benchmark.version,
    beforeScore,
    proposedScore,
    scoreDelta: proposedScore - beforeScore,
    beforeTitleCoverage,
    proposedTitleCoverage,
    beforeDescriptionCoverage,
    proposedDescriptionCoverage,
    beforeUnsupportedClaimCount: beforeUnsupported.length,
    proposedUnsupportedClaimCount: proposedUnsupported.length,
    beforeSafetyPassed: beforeUnsupported.length === 0,
    proposedSafetyPassed: proposedUnsupported.length === 0,
    unsupportedClaimsRemoved,
    regressions,
  };
}

function ngrams(text: string, length: number): Set<string> {
  const result = new Set<string>();
  for (let index = 0; index <= text.length - length; index++) {
    result.add(text.slice(index, index + length));
  }
  return result;
}

export function findBenchmarkCopyOverlap(
  proposal: CopyProposal,
  benchmark: CopyBenchmark,
  minimumLength = 28,
): string | null {
  const generated = normalizedText(`${proposal.title ?? ''}\n${proposal.description ?? ''}`);
  if (generated.length < minimumLength) return null;
  const generatedNgrams = ngrams(generated, minimumLength);
  for (const item of benchmark.items) {
    const reference = normalizedText(`${item.title}\n${item.description ?? ''}`);
    for (let index = 0; index <= reference.length - minimumLength; index++) {
      const candidate = reference.slice(index, index + minimumLength);
      if (generatedNgrams.has(candidate)) return candidate;
    }
  }
  return null;
}
