/**
 * Job: Seed default listing review policies.
 *
 * Creates default policies for scheduled listing quality review.
 *
 * Daily technical/OCR review runs broadly on active listings with images.
 * Weekly quality review is kept curated/inactive until Phase 4 Qwen review.
 *
 * Usage:
 *   npm run job:quality:seed-policies
 *
 * Idempotent — updates policies that already exist by name.
 */

import { supabase } from '../lib/supabase.js';

interface PolicySeed {
  name: string;
  marketplace: 'amazon' | 'rakuten' | 'mercari';
  scope_type: 'curated' | 'active_with_images';
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
    scope_type: 'active_with_images',
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
    scope_type: 'active_with_images',
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
    scope_type: 'active_with_images',
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
  let updated = 0;
  let errors = 0;

  for (const policy of DEFAULT_POLICIES) {
    // Check if already exists by name
    const { data: existing, error: lookupError } = await supabase
      .from('listing_review_policies')
      .select('id')
      .eq('name', policy.name)
      .limit(1);

    if (lookupError) {
      console.error(`  ERROR: "${policy.name}" lookup — ${lookupError.message}`);
      errors++;
      continue;
    }

    if (existing && existing.length > 0) {
      const { error } = await supabase
        .from('listing_review_policies')
        .update({
          ...policy,
          updated_at: new Date().toISOString(),
        })
        .eq('id', (existing[0] as { id: string }).id);

      if (error) {
        console.error(`  ERROR: "${policy.name}" update — ${error.message}`);
        errors++;
      } else {
        console.log(`  UPDATE: "${policy.name}" — ${policy.marketplace} ${policy.review_type} ${policy.scope_type}`);
        updated++;
      }
      continue;
    }

    const { error } = await supabase
      .from('listing_review_policies')
      .insert(policy);

    if (error) {
      console.error(`  ERROR: "${policy.name}" — ${error.message}`);
      errors++;
    } else {
      console.log(`  INSERT: "${policy.name}" — ${policy.marketplace} ${policy.review_type} ${policy.scope_type}`);
      inserted++;
    }
  }

  console.log(`\n=== Done: ${inserted} inserted, ${updated} updated, ${errors} errors ===`);
  if (errors > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
