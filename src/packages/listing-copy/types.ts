export type CopyMode = 'dry_run' | 'approval' | 'auto';
export type CopyProvider = 'deepseek' | 'ollama';

export interface CopyBenchmarkTopic {
  name: string;
  terms: string[];
}

export interface CopyBenchmarkItem {
  externalListingId: string;
  rankPosition: number | null;
  title: string;
  description: string | null;
  isSponsored: boolean;
}

export interface CopyBenchmark {
  id: string;
  marketplace: string;
  categoryId: string | null;
  categoryName: string | null;
  scopeKey: string;
  selectionMode: 'automatic' | 'operator';
  version: number;
  sourceKind: string;
  capturedAt: string;
  titleTerms: string[];
  descriptionTopics: CopyBenchmarkTopic[];
  assortment: {
    strategy: 'single_size' | 'multi_size' | 'unknown';
    observedSizes: string[];
    multiSizeListingCount: number;
    multiSizeListingRatio: number;
  };
  items: CopyBenchmarkItem[];
}

export interface CopyBenchmarkEvaluation {
  benchmarkId: string;
  benchmarkVersion: number;
  beforeScore: number;
  proposedScore: number;
  scoreDelta: number;
  beforeTitleCoverage: number;
  proposedTitleCoverage: number;
  beforeDescriptionCoverage: number;
  proposedDescriptionCoverage: number;
  beforeUnsupportedClaimCount: number;
  proposedUnsupportedClaimCount: number;
  beforeSafetyPassed: boolean;
  proposedSafetyPassed: boolean;
  unsupportedClaimsRemoved: number;
  regressions: string[];
}

export interface CopyClaimSelection {
  titleClaimIds: string[];
  descriptionClaimIds: string[];
}

export interface CopyClaimAttribution {
  target: 'title' | 'description';
  claimId: string;
  renderedText: string;
}

export interface ListingClaimPack {
  parentSpu: {
    spuCode: string | null;
    productTypes: string[];
    sizes: string[];
    tripDuration: string | null;
    features: string[];
  };
  selectedVariant: {
    itemCode: string | null;
    weightKg: number | null;
    packageQuantity: number | null;
    countryOfOrigin: string | null;
    assemblyStatus: string | null;
  };
  commonAcrossChildren: {
    weightKg: number | null;
    packageQuantity: number | null;
    countryOfOrigin: string | null;
    assemblyStatus: string | null;
  };
  assortment: {
    strategy: 'single_size' | 'multi_size' | 'unknown';
    childCount: number;
    sizes: string[];
  };
  groundedNumericTokens: string[];
  unsupportedOrMissing: string[];
}

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
  provider: CopyProvider;
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
  category_id: string | null;
  category_name: string | null;
  content_revision: number;
  is_hero: boolean;
  trusted_facts: Record<string, unknown>;
  verified_claim_pack?: ListingClaimPack;
  benchmark?: CopyBenchmark;
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
  claimSelection?: CopyClaimSelection;
  claimAttributions?: CopyClaimAttribution[];
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
  benchmarkEvaluation: CopyBenchmarkEvaluation | null;
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
  benchmarked: number;
  missingBenchmark: number;
  benchmarkImproved: number;
  benchmarkNotImproved: number;
  benchmarkReused: number;
  benchmarkStale: number;
  benchmarkIdentified: number;
  benchmarkIdentificationFailed: number;
  benchmarkExternalRequests: number;
  benchmarkRowsWritten: number;
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
