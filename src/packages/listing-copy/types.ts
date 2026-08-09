export type CopyMode = 'dry_run' | 'approval' | 'auto';

export interface CopyImproveOptions {
  mode: CopyMode;
  limit: number;
  listingId?: string;
  shopCode?: string;
  model?: string;
  applyApproved?: boolean;
}

export interface CopyImproveConfig {
  enabled: boolean;
  autoShops: Set<string>;
  confidenceThreshold: number;
  model: string;
  ollamaUrl: string;
  promptProfile: string;
  promptVersion: string;
}

export interface ListingRow {
  id: string;
  platform: string;
  shop_code: string;
  title: string | null;
  description: string | null;
  variant_id: string | null;
  product_spu_id: string | null;
  product_family_id: string | null;
  content_revision: number;
  is_hero: boolean;
  trusted_facts: Record<string, unknown>;
}

export interface WorkItemRow {
  id: string;
  workflow_type: string;
  target_type: string;
  target_id: string;
  target_key: string;
  platform: string | null;
  shop_code: string | null;
  is_hero: boolean;
  status: string;
  source_context: Record<string, unknown>;
  source_snapshot_hash: string | null;
  deterministic_findings: Record<string, unknown>[];
  latest_result_id: string | null;
}

export interface CopyProposal {
  title: string | null;
  description: string | null;
  confidence: number;
  rationale: string;
}

export interface CopyProposalResult {
  listingId: string;
  workItemId: string;
  shopCode: string;
  platform: string;
  isHero: boolean;
  mode: CopyMode;
  proposal: CopyProposal | null;
  validationStatus: 'valid' | 'repaired' | 'invalid' | 'failed';
  validationErrors: string[];
  repairAttempts: number;
  llmModel: string;
  promptProfile: string;
  promptVersion: string;
  inputHash: string;
  outputHash: string;
  reviewId: string | null;
  resultId: string | null;
  runId: string | null;
  autoApplied: boolean;
  errorMessage?: string;
}

export interface ApplyResult {
  listingId: string;
  workItemId: string;
  contentRevision: number | null;
  outcome: 'updated' | 'stale_revision' | 'replay' | 'not_found' | 'error';
  measurementResult?: string;
  measurementFailed?: boolean;
}

export interface FinalizationSummary {
  selected: number;
  proposed: number;
  valid: number;
  invalid: number;
  autoApplied: number;
  awaitingApproval: number;
  approvedApplied: number;
  stale: number;
  failed: number;
  measurementFailed: number;
  requestCount: number;
  rowCount: number;
  runtimeMs: number;
  error?: string;
}

export type ContentUpdateOutcome = 'updated' | 'stale_revision' | 'replay' | 'not_found' | 'error';

export interface ApplyContentUpdateOptions {
  listingId: string;
  title: string | null;
  description: string | null;
  expectedRevision: number;
  idempotencyKey: string;
  model: string;
  promptVersion: string;
}
