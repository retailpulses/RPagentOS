import {
  captureRakutenBenchmark,
  persistBenchmarkSet,
  activateBenchmarkSet,
  type BenchmarkCaptureResult,
} from '../packages/listing-copy/benchmark-capture.js';

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  const query = argValue('query');
  const scopeKey = argValue('scope-key');
  const categoryId = argValue('category-id');
  const categoryName = argValue('category-name');
  const limitArg = argValue('limit');
  const persist = hasFlag('persist');
  const activate = hasFlag('activate');
  const operatorDesignated = hasFlag('operator-designated');

  if (!query) {
    console.error('Missing required argument: --query');
    console.error('Usage: tsx src/jobs/capture-rakuten-copy-benchmark.ts --query="..." [--scope-key=...] [--category-id=...] [--category-name=...] [--limit=10] [--persist] [--activate] [--operator-designated]');
    process.exit(1);
  }

  if (activate && !persist) {
    console.error('--activate requires --persist');
    process.exit(1);
  }

  const limit = limitArg ? parseInt(limitArg, 10) : undefined;
  if (limitArg && (isNaN(limit as number) || (limit as number) < 1 || (limit as number) > 10)) {
    console.error('--limit must be between 1 and 10');
    process.exit(1);
  }

  let result: BenchmarkCaptureResult;

  try {
    result = await captureRakutenBenchmark({
      query,
      scopeKey,
      categoryId,
      categoryName,
      limit,
    });
  } catch (error) {
    console.error('Capture failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }

  if (!persist) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const selectionMode = operatorDesignated ? 'operator' : 'automatic';
  const { supabase } = await import('../lib/supabase.js');

  let setId: string;
  let version: number;

  try {
    ({ setId, version } = await persistBenchmarkSet(supabase, result, {
      selectionMode,
      designatedBy: operatorDesignated ? process.env['USER'] ?? undefined : undefined,
    }));
  } catch (error) {
    console.error('Persist failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }

  if (activate) {
    try {
      await activateBenchmarkSet(supabase, setId);
    } catch (error) {
      console.error('Activation failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  }

  const output = {
    setId,
    version,
    marketplace: result.marketplace,
    scopeKey: result.scopeKey,
    categoryId: result.categoryId,
    categoryName: result.categoryName,
    status: activate ? 'active' : 'draft',
    selectionMode,
    itemCount: result.items.length,
    titleTerms: result.targetProfile.titleTerms.length,
    capturedAt: result.capturedAt,
    items: result.items,
    targetProfile: result.targetProfile,
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error('capture-rakuten-copy-benchmark failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
