import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { auditListings, parseListingAuditFile } from '../packages/listing-audit/index.js';

interface Args {
  file: string;
  outputDir: string;
}

function parseArgs(argv: string[]): Args {
  const fileArg = argv.find(arg => arg.startsWith('--file='));
  const outputArg = argv.find(arg => arg.startsWith('--output-dir='));

  return {
    file: fileArg ? fileArg.split('=')[1] : 'data/sample-shop4-listings.json',
    outputDir: outputArg ? outputArg.split('=')[1] : 'outputs/listing-audit',
  };
}

function main() {
  const args = parseArgs(process.argv);
  const content = readFileSync(args.file, 'utf-8');
  const listings = parseListingAuditFile(content, args.file);
  const batch = auditListings(listings);

  mkdirSync(args.outputDir, { recursive: true });
  const resultsPath = join(args.outputDir, 'audit-results.json');
  const resultsJsonlPath = join(args.outputDir, 'audit-results.jsonl');

  writeFileSync(resultsPath, JSON.stringify(batch, null, 2), 'utf-8');
  writeFileSync(
    resultsJsonlPath,
    batch.results.map(result => JSON.stringify(result)).join('\n') + (batch.results.length > 0 ? '\n' : ''),
    'utf-8',
  );

  console.log('Listing audit complete:');
  console.log(`  source_file:   ${args.file}`);
  console.log(`  output_dir:    ${args.outputDir}`);
  console.log(`  listings:      ${batch.summary.total}`);
  console.log(`  average_score: ${batch.summary.averageScore}`);
  console.log(`  high_priority: ${batch.summary.priorityCounts.high}`);
  console.log(`  results_json:  ${resultsPath}`);
  console.log(`  results_jsonl: ${resultsJsonlPath}`);
}

main();
