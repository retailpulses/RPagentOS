import { visibleListingText } from './preserve-first-enrich.js';

export interface ListingCopyDiff {
  titleChanged: boolean;
  beforeTitle: string;
  afterTitle: string;
  beforeDescriptionLength: number;
  afterDescriptionLength: number;
  addedLines: string[];
  removedLines: string[];
}

function normalizedLines(value: string): Array<{ key: string; value: string }> {
  return visibleListingText(value).split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({
      key: line.normalize('NFKC').toLowerCase().replace(/\s+/g, ''),
      value: [...line].length > 140 ? `${[...line].slice(0, 137).join('')}...` : line,
    }));
}

export function buildListingCopyDiff(input: {
  beforeTitle: string;
  afterTitle: string;
  beforeDescription: string;
  afterDescription: string;
}): ListingCopyDiff {
  const beforeLines = normalizedLines(input.beforeDescription);
  const afterLines = normalizedLines(input.afterDescription);
  const beforeKeys = new Set(beforeLines.map((line) => line.key));
  const afterKeys = new Set(afterLines.map((line) => line.key));
  return {
    titleChanged: input.beforeTitle !== input.afterTitle,
    beforeTitle: input.beforeTitle,
    afterTitle: input.afterTitle,
    beforeDescriptionLength: [...visibleListingText(input.beforeDescription)].length,
    afterDescriptionLength: [...visibleListingText(input.afterDescription)].length,
    addedLines: afterLines.filter((line) => !beforeKeys.has(line.key)).map((line) => line.value).slice(0, 8),
    removedLines: beforeLines.filter((line) => !afterKeys.has(line.key)).map((line) => line.value).slice(0, 8),
  };
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function textValue(value: unknown, fallback = 'unknown'): string {
  return typeof value === 'string' && value ? value : fallback;
}

function truncateUtf8(value: string, maxBytes = 3800): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  let result = '';
  for (const char of value) {
    if (Buffer.byteLength(`${result}${char}\n…`, 'utf8') > maxBytes) break;
    result += char;
  }
  return `${result}\n…`;
}

export function buildWecomCopyReport(input: {
  report: Record<string, unknown> | null;
  jobStatus: string;
  runUrl?: string;
}): string {
  const report = input.report;
  const outcome = !report ? '❌ failed before report creation'
    : numberValue(report.applyFailed) > 0 ? '❌ apply failure'
      : numberValue(report.canonicalApplied) > 0 ? '✅ canonical updated'
        : '⚠️ completed, no canonical update';
  const lines = [
    `## Rakuten DeepSeek 文案 Loop — ${outcome}`,
    `> Job status: ${input.jobStatus}`,
  ];
  if (!report) {
    lines.push('- No structured report was produced. Check the workflow logs.');
  } else {
    lines.push(
      `- Mode: ${textValue(report.mode)}`,
      `- Selected: ${numberValue(report.selected)} | Safety passed: ${numberValue(report.safetyPassed)} | Auto eligible: ${numberValue(report.autoEligible)}`,
      `- Canonical applied: ${numberValue(report.canonicalApplied)} | Skipped/stale/failed: ${numberValue(report.selected) - numberValue(report.canonicalApplied)}/${numberValue(report.stale)}/${numberValue(report.applyFailed)}`,
      `- Runtime: ${(numberValue(report.runtimeMs) / 1000).toFixed(1)}s | LLM requests: ${numberValue(report.llmRequests)}`,
    );
    const results = Array.isArray(report.results) ? report.results : [];
    for (const raw of results.slice(0, 5)) {
      if (!raw || typeof raw !== 'object') continue;
      const result = raw as Record<string, unknown>;
      const diff = result.diff && typeof result.diff === 'object'
        ? result.diff as Record<string, unknown> : {};
      lines.push(
        '',
        `### Listing ${textValue(result.listingId)}`,
        `- Outcome: ${textValue(result.applyOutcome, 'not_applied')} | Opportunity: ${numberValue(result.opportunityScore)} | Commercial Δ: ${numberValue(result.commercialDelta)} | Confidence: ${numberValue(result.confidence).toFixed(2)}`,
      );
      if (diff.titleChanged === true) {
        lines.push(`- Title − ${textValue(diff.beforeTitle, '')}`, `- Title + ${textValue(diff.afterTitle, '')}`);
      } else {
        lines.push('- Title: unchanged');
      }
      lines.push(`- Description: ${numberValue(diff.beforeDescriptionLength)} → ${numberValue(diff.afterDescriptionLength)} chars`);
      const added = Array.isArray(diff.addedLines) ? diff.addedLines.filter((line): line is string => typeof line === 'string') : [];
      const removed = Array.isArray(diff.removedLines) ? diff.removedLines.filter((line): line is string => typeof line === 'string') : [];
      for (const line of removed.slice(0, 4)) lines.push(`- − ${line}`);
      for (const line of added.slice(0, 6)) lines.push(`- + ${line}`);
      if (typeof result.error === 'string' && result.error) lines.push(`- Error: ${result.error.slice(0, 300)}`);
    }
  }
  if (input.runUrl) lines.push('', `[Open workflow run](${input.runUrl})`);
  return truncateUtf8(lines.join('\n'));
}
