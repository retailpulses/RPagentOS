import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type TargetKind = 'local' | 'cloud' | 'unknown';

interface RelationCheck {
  name: string;
  requiredFor: 'base' | 'workbench' | 'qwen';
  exists: boolean;
  count: number | null;
  error: string | null;
}

const REQUIRED_RELATIONS: Array<Pick<RelationCheck, 'name' | 'requiredFor'>> = [
  { name: 'product_families', requiredFor: 'base' },
  { name: 'product_spus', requiredFor: 'base' },
  { name: 'product_variants', requiredFor: 'base' },
  { name: 'platform_listings', requiredFor: 'base' },
  { name: 'platform_listing_skus', requiredFor: 'base' },
  { name: 'product_platform_links', requiredFor: 'base' },
  { name: 'listing_work_items', requiredFor: 'workbench' },
  { name: 'listing_target_classification_v1', requiredFor: 'workbench' },
  { name: 'listing_intelligence_runs', requiredFor: 'qwen' },
  { name: 'listing_intelligence_results', requiredFor: 'qwen' },
  { name: 'listing_qwen_reviews', requiredFor: 'qwen' },
  { name: 'listing_qwen_review_requests', requiredFor: 'qwen' },
];

const url = process.env['SUPABASE_URL'];
const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
const args = new Set(process.argv.slice(2));
const explicitSqlEditorRef = readArgValue('--sql-editor-project-ref');
const migrationTarget = readArgValue('--migration-target');

function readArgValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return match?.slice(prefix.length);
}

function classifyTarget(rawUrl: string | undefined): { kind: TargetKind; projectRef: string | null } {
  if (!rawUrl) return { kind: 'unknown', projectRef: null };

  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
      return { kind: 'local', projectRef: null };
    }
    const cloudMatch = host.match(/^([a-z0-9]+)\.supabase\.co$/);
    if (cloudMatch) return { kind: 'cloud', projectRef: cloudMatch[1] };
    return { kind: 'unknown', projectRef: null };
  } catch {
    return { kind: 'unknown', projectRef: null };
  }
}

function readLinkedProjectRef(): string | null {
  const tempRefPath = resolve('supabase/.temp/project-ref');
  if (!existsSync(tempRefPath)) return null;
  const ref = readFileSync(tempRefPath, 'utf8').trim();
  return ref || null;
}

function supabaseCliStatus(): { installed: boolean; linked: boolean; linkedProjectRef: string | null } {
  const linkedProjectRef = readLinkedProjectRef();
  try {
    execFileSync('supabase', ['--version'], { stdio: 'ignore' });
    return { installed: true, linked: Boolean(linkedProjectRef), linkedProjectRef };
  } catch {
    return { installed: false, linked: Boolean(linkedProjectRef), linkedProjectRef };
  }
}

async function checkRelation(name: string, requiredFor: RelationCheck['requiredFor']): Promise<RelationCheck> {
  if (!url || !key) {
    return { name, requiredFor, exists: false, count: null, error: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing' };
  }

  const supabase = createClient(url, key);
  const probe = await supabase
    .from(name)
    .select('*')
    .limit(1);

  if (probe.error) {
    return { name, requiredFor, exists: false, count: null, error: probe.error.message };
  }

  const { count, error } = await supabase
    .from(name)
    .select('*', { count: 'exact', head: true });

  if (error) {
    return { name, requiredFor, exists: false, count: null, error: error.message };
  }
  return { name, requiredFor, exists: true, count: count ?? 0, error: null };
}

function hasCloudMigrationCredentials(): boolean {
  return Boolean(
    process.env['SUPABASE_ACCESS_TOKEN']
    && process.env['SUPABASE_PROJECT_REF']
    && process.env['SUPABASE_DB_PASSWORD'],
  );
}

function fail(message: string): never {
  console.error(`\nDB doctor failed: ${message}`);
  process.exit(1);
}

async function main() {
  const target = classifyTarget(url);
  const cli = supabaseCliStatus();

  console.log('=== RPagentOS DB Doctor ===');
  console.log(`SUPABASE_URL: ${url ?? '(missing)'}`);
  console.log(`Target: ${target.kind}`);
  console.log(`Project ref: ${target.projectRef ?? '-'}`);
  console.log(`Supabase CLI installed: ${cli.installed ? 'yes' : 'no'}`);
  console.log(`Supabase CLI linked: ${cli.linked ? 'yes' : 'no'}`);
  console.log(`Linked project ref: ${cli.linkedProjectRef ?? '-'}`);

  if (!url) fail('SUPABASE_URL is missing. .env.local controls where local jobs run.');
  if (!key) fail('SUPABASE_SERVICE_ROLE_KEY is missing. The doctor needs it to inspect tables and views.');

  if (target.kind === 'local' && explicitSqlEditorRef) {
    fail(`.env.local targets local Supabase, but a SQL Editor cloud project ref was supplied (${explicitSqlEditorRef}). Local jobs and Supabase SQL Editor are separate databases.`);
  }

  if (target.kind === 'local' && process.env['SUPABASE_PROJECT_REF'] && !args.has('--allow-local-with-project-ref')) {
    fail('SUPABASE_PROJECT_REF is set while SUPABASE_URL targets local Supabase. Unset it or pass --allow-local-with-project-ref if this is intentional.');
  }

  if (target.kind === 'cloud' && cli.linkedProjectRef && target.projectRef && cli.linkedProjectRef !== target.projectRef) {
    fail(`Supabase CLI is linked to ${cli.linkedProjectRef}, but SUPABASE_URL points at ${target.projectRef}.`);
  }

  if (migrationTarget === 'cloud' && !hasCloudMigrationCredentials()) {
    fail('cloud migration deploy requested, but SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF, and SUPABASE_DB_PASSWORD are not all set.');
  }

  const checks = await Promise.all(REQUIRED_RELATIONS.map((relation) => checkRelation(relation.name, relation.requiredFor)));

  console.log('\nRelations:');
  for (const check of checks) {
    const state = check.exists ? `ok, rows=${check.count}` : `missing (${check.error})`;
    console.log(`- ${check.name}: ${state}`);
  }

  const missingBase = checks.filter((check) => check.requiredFor === 'base' && !check.exists);
  if (missingBase.length > 0) {
    fail(`base product/listing schema is missing: ${missingBase.map((check) => check.name).join(', ')}`);
  }

  const missingWorkbench = checks.filter((check) => check.requiredFor === 'workbench' && !check.exists);
  if (missingWorkbench.length > 0) {
    fail(`listing workbench migration is missing: ${missingWorkbench.map((check) => check.name).join(', ')}`);
  }

  const missingQwen = checks.filter((check) => check.requiredFor === 'qwen' && !check.exists);
  if (missingQwen.length > 0) {
    fail(`MVP-1 Qwen review migration is missing: ${missingQwen.map((check) => check.name).join(', ')}`);
  }

  console.log('\nDB doctor passed.');
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
