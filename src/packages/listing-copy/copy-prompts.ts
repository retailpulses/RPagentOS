import { type ListingRow } from './types.js';

export const PROMPT_PROFILE = 'rakuten_copy_improvement_v1';
export const PROMPT_VERSION = 'v1';

export function buildCopyImprovementPrompt(
  listing: ListingRow,
  repairErrors?: string[],
): string {
  const sourceFacts: Record<string, unknown> = {
    platform: listing.platform,
    shop_code: listing.shop_code,
    current_title: listing.title ?? '(no title)',
    current_description: listing.description ?? '(no description)',
    verified_product_facts: listing.trusted_facts,
  };

  const instructions = [
    'You are a Rakuten listing copy improvement assistant for RPagentOS.',
    'Your task is to improve the Japanese title and description for a Rakuten product listing.',
    '',
    'RULES:',
    '- Return ONLY a single JSON object. No markdown, no explanations outside JSON.',
    '- The suggested title must be a concise, search-optimised Rakuten title in Japanese.',
    '- The suggested description must be an informative product description in Japanese.',
    '- Do NOT create or invent facts: all product details must appear explicitly in SOURCE LISTING.',
    '- Do NOT include prohibited claims: No.1, ナンバーワン, 最安, 絶対, 完全防水, 医療, 治療, 永久保証, or similar superlatives/medical claims.',
    '- Keep the title at or below 127 Unicode characters and the description at or below 5000 Unicode characters.',
    '- If the current copy is already acceptable and well-optimised, return null for both fields.',
    '- Confidence (0-1) must reflect how grounded the suggestions are in the source facts.',
    '- If you cannot make a material improvement, set title and description to null to indicate no change.',
    '',
    'SOURCE LISTING:',
    JSON.stringify(sourceFacts, null, 2),
    '',
    'REQUIRED JSON SHAPE:',
    JSON.stringify({
      title: 'string | null — improved Japanese title, or null if no improvement needed',
      description: 'string | null — improved Japanese description, or null if no improvement needed',
      confidence: 'number 0-1 — confidence that suggestions are grounded and compliant',
      rationale: 'string — brief explanation of changes made or why no changes were needed',
    }),
  ];

  if (repairErrors && repairErrors.length > 0) {
    instructions.push(
      '',
      'REPAIR INSTRUCTIONS:',
      'Your previous output was rejected with these errors:',
      ...repairErrors.map((e) => `  - ${e}`),
      'Please return corrected JSON that fixes all the listed issues.',
    );
  }

  return instructions.join('\n');
}
