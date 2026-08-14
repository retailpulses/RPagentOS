import { type CopyProposal } from './types.js';

export interface GenericRepairIssue {
  kind: 'numeric' | 'hard_fact' | 'prohibited' | 'unsupported_audit';
  needle: string;
  source: string;
}

export interface GenericRepairResult {
  proposal: CopyProposal;
  changed: boolean;
  removedTitleParts: string[];
  removedDescriptionParts: string[];
  unresolvedIssues: GenericRepairIssue[];
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function repairIssuesFromErrors(errors: string[]): GenericRepairIssue[] {
  return errors.flatMap((error): GenericRepairIssue[] => {
    for (const [prefix, kind] of [
      ['Generated copy includes unsourced numeric fact: ', 'numeric'],
      ['Generated copy includes hard fact without trusted-fact evidence: ', 'hard_fact'],
      ['Generated copy includes prohibited claim: ', 'prohibited'],
      ['unsupported hard claim: ', 'unsupported_audit'],
    ] as const) {
      if (error.startsWith(prefix)) {
        const needle = error.slice(prefix.length).trim();
        return needle ? [{ kind, needle, source: error }] : [];
      }
    }
    return [];
  });
}

function normalized(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

function containsNeedle(value: string, issue: GenericRepairIssue): boolean {
  const haystack = normalized(value);
  const needle = normalized(issue.needle);
  if (needle && haystack.includes(needle)) return true;
  if (issue.kind !== 'unsupported_audit') return false;
  const meaningful = issue.needle.normalize('NFKC')
    .split(/[\s　:：,，、。・()（）【】「」]+/)
    .map((token) => normalized(token))
    .filter((token) => token.length >= 2);
  return meaningful.length > 0 && meaningful.every((token) => haystack.includes(token));
}

function repairTitle(title: string, issues: GenericRepairIssue[]): {
  value: string; removed: string[];
} {
  const removed: string[] = [];
  const parts = title.split(/[\s　]+/).filter(Boolean);
  const kept = parts.filter((part) => {
    if (!issues.some((issue) => containsNeedle(part, issue))) return true;
    removed.push(part);
    return false;
  });
  return { value: kept.join(' ').trim(), removed };
}

function splitDescription(value: string): Array<{ text: string; separator: string }> {
  const result: Array<{ text: string; separator: string }> = [];
  const pattern = /([^。！？\n]+)([。！？\n]+|$)/g;
  for (const match of value.matchAll(pattern)) {
    if (match[1]?.trim()) result.push({ text: match[1], separator: match[2] ?? '' });
  }
  return result;
}

function repairDescription(description: string, issues: GenericRepairIssue[]): {
  value: string; removed: string[];
} {
  const removed: string[] = [];
  const repaired = splitDescription(description).flatMap((sentence) => {
    const matching = issues.filter((issue) => containsNeedle(sentence.text, issue));
    if (matching.length === 0) return [`${sentence.text}${sentence.separator}`];

    const clauses = sentence.text.split(/([、，,；;])/);
    const kept: string[] = [];
    for (let index = 0; index < clauses.length; index += 2) {
      const clause = clauses[index] ?? '';
      const separator = clauses[index + 1] ?? '';
      if (matching.some((issue) => containsNeedle(clause, issue))) {
        if (clause.trim()) removed.push(clause.trim());
        continue;
      }
      kept.push(clause, separator);
    }
    let value = kept.join('').replace(/^[、，,；;\s]+|[、，,；;\s]+$/g, '').trim();
    if (matching.some((issue) => containsNeedle(value, issue))) {
      removed.push(sentence.text.trim());
      value = '';
    }
    return value ? [`${value}${sentence.separator}`] : [];
  }).join('')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[、，,；;\s]+|[、，,；;\s]+$/g, '')
    .trim();
  return { value: repaired, removed };
}

export function deterministicallyRepairGenericProposal(
  proposal: CopyProposal,
  issues: GenericRepairIssue[],
): GenericRepairResult {
  const usableIssues = unique(issues.filter((issue) => issue.needle.trim()).map((issue) =>
    `${issue.kind}\u0000${issue.needle}\u0000${issue.source}`,
  )).map((value) => {
    const [kind, needle, source] = value.split('\u0000');
    return { kind: kind as GenericRepairIssue['kind'], needle: needle!, source: source! };
  });
  const title = proposal.title ? repairTitle(proposal.title, usableIssues) : { value: '', removed: [] };
  const description = proposal.description
    ? repairDescription(proposal.description, usableIssues) : { value: '', removed: [] };
  const combined = `${title.value}\n${description.value}`;
  const unresolvedIssues = usableIssues.filter((issue) => containsNeedle(combined, issue));
  const repairedProposal: CopyProposal = {
    ...proposal,
    title: title.value || null,
    description: description.value || null,
    rationale: `${proposal.rationale} Deterministic hard-fact repair removed ${title.removed.length + description.removed.length} unsupported part(s).`,
  };
  return {
    proposal: repairedProposal,
    changed: title.removed.length + description.removed.length > 0,
    removedTitleParts: title.removed,
    removedDescriptionParts: description.removed,
    unresolvedIssues,
  };
}
