/**
 * Job: Seed default listing review policies.
 *
 * Creates curated-subset policies for Phase 1 daily technical/OCR review.
 * Curated = Hero Products + active listings with images.
 *
 * Usage:
 *   npm run job:quality:seed-policies
 *
 * Idempotent — skips policies that already exist by name.
 */

import { supabase } from '../lib/supabase.js';

interface PolicySeed {
  name: string;
  marketplace: 'amazon' | 'rakuten' | 'mercari';
  scope_type: 'curated';
  review_type: 'daily_technical' | 'weekly_quality';
  schedule_cron: string;
  priority: number;
  qwen_enabled: boolean;
  is_active: boolean;
}

const DEFAULT_POLICIES: PolicySeed[] = [
  // Amazon — daily technical (no Qwen)
  {
    name: 'Amazon daily technical review',
    marketplace: 'amazon',
    scope_type: 'curated',
    review_type: 'daily_technical',
    schedule_cron: '7 3 * * *',
    priority: 100,
    qwen_enabled: false,
    is_active: true,
  },
  // Amazon — weekly quality (Qwen deferred to Phase 4, enabled=false for now)
  {
    name: 'Amazon weekly quality review',
    marketplace: 'amazon',
    scope_type: 'curated',
    review_type: 'weekly_quality',
    schedule_cron: '7 4 * * 1',
    priority: 90,
    qwen_enabled: false,
    is_active: false,
  },
  // Rakuten — daily technical (no Qwen)
  {
    name: 'Rakuten daily technical review',
    marketplace: 'rakuten',
    scope_type: 'curated',
    review_type: 'daily_technical',
    schedule_cron: '17 3 * * *',
    priority: 100,
    qwen_enabled: false,
    is_active: true,
  },
  // Rakuten — weekly quality (Qwen deferred to Phase 4)
  {
    name: 'Rakuten weekly quality review',
    marketplace: 'rakuten',
    scope_type: 'curated',
    review_type: 'weekly_quality',
    schedule_cron: '17 4 * * 1',
    priority: 90,
    qwen_enabled: false,
    is_active: false,
  },
  // Mercari — daily technical (no Qwen)
  {
    name: 'Mercari daily technical review',
    marketplace: 'mercari',
    scope_type: 'curated',
    review_type: 'daily_technical',
    schedule_cron: '27 3 * * *',
    priority: 100,
    qwen_enabled: false,
    is_active: true,
  },
];

async function main(): Promise<void> {
  console.log('=== Seed Listing Review Policies ===\n');

  let inserted = 0;
  let skipped = 0;

  for (const policy of DEFAULT_POLICIES) {
    // Check if already exists by name
    const { data: existing } = await supabase
      .from('listing_review_policies')
      .select('id')
      .eq('name', policy.name)
      .limit(1);

    if (existing && existing.length > 0) {
      console.log(`  SKIP: "${policy.name}" already exists`);
      skipped++;
      continue;
    }

    const { error } = await supabase
      .from('listing_review_policies')
      .insert(policy);

    if (error) {
      console.error(`  ERROR: "${policy.name}" — ${error.message}`);
    } else {
      console.log(`  OK: "${policy.name}" — ${policy.marketplace} ${policy.review_type}`);
      inserted++;
    }
  }

  console.log(`\n=== Done: ${inserted} inserted, ${skipped} skipped ===`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
