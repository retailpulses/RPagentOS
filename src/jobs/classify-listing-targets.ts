import { classifyListingTargets, markStaleWorkItems } from '../packages/listing-intelligence/classify-targets.js';

const args = process.argv.slice(2);
const skipStale = args.includes('--skip-stale');

async function main() {
  const result = await classifyListingTargets();

  console.log('\n=== Classification Summary ===');
  console.log(`View rows:       ${result.view_rows}`);
  console.log(`Upserted:        ${result.upserted}`);
  console.log(`Errors:          ${result.errors}`);
  console.log('\nBreakdown:');
  for (const [key, count] of Object.entries(result.breakdown)) {
    console.log(`  ${key}: ${count}`);
  }

  if (!skipStale) {
    const staleCount = await markStaleWorkItems();
    console.log(`\nStale items marked: ${staleCount}`);
  }

  console.log('\nDone.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Classification failed:', err);
    process.exit(1);
  });
