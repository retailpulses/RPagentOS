import { runQwenReviewForWorkItem } from '../packages/listing-intelligence/qwen-review.js';

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const workItemId = argValue('work-item-id') ?? process.argv.find((arg) => /^[0-9a-f-]{36}$/i.test(arg));
const force = process.argv.includes('--force');
const model = argValue('model');

if (!workItemId) {
  console.error('Usage: npm run job:listing:qwen -- --work-item-id=<uuid> [--force] [--model=qwen3.5:9b]');
  process.exit(1);
}

runQwenReviewForWorkItem(workItemId, { force, model })
  .then((result) => {
    console.log('\n=== Qwen Review Complete ===');
    console.log(`Review: ${result.review_id}`);
    console.log(`Result: ${result.result_id}`);
    console.log(`Run: ${result.run_id}`);
    console.log(`Status: ${result.validation_status}`);
    console.log(`Repairs: ${result.repair_attempts}`);
    console.log(`Model: ${result.llm_model}`);
    console.log(`Profile: ${result.prompt_profile}`);
    console.log(`Reused existing: ${result.skipped_existing ? 'yes' : 'no'}`);
    console.log(`Summary: ${result.summary ?? '-'}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('Qwen review failed:', err);
    process.exit(1);
  });
