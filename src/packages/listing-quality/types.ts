// Listing Quality Engineering — shared types for Phase 1+ pipeline.
//
// Tables: listing_review_policies, listing_review_jobs, listing_review_snapshots,
//         listing_review_snapshot_images, listing_review_results.
//
// Phase 2 adds: ScoreInput, ScoreOutput, ScoreGrade, MarketplaceScoreWeights
// (imported from marketplace-config.ts and score-engine.ts).

// ─── Enum types ───────────────────────────────────────────────────────────────

export type Marketplace = 'amazon' | 'rakuten' | 'mercari';

export type ReviewType = 'daily_technical' | 'weekly_quality' | 'manual' | 'event_triggered';

export type TriggerSource = 'scheduled' | 'event' | 'manual' | 're_review';

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type ScoreStatus = 'partial' | 'complete' | 'failed';

export type Confidence = 'low' | 'medium' | 'high';

export type ReviewCompleteness =
  | 'technical_only'
  | 'technical_ocr'
  | 'technical_ocr_marketplace'
  | 'technical_ocr_qwen'
  | 'full_review';

export type PolicyScopeType = 'curated' | 'hero_products' | 'active_with_images' | 'all_active' | 'custom';

// ─── Review Policy ────────────────────────────────────────────────────────────

export interface ReviewPolicy {
  id: string;
  name: string;
  marketplace: Marketplace;
  scope_type: PolicyScopeType;
  scope_filter_json: Record<string, unknown>;
  review_type: ReviewType;
  schedule_cron: string | null;
  priority: number;
  qwen_enabled: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Review Job ───────────────────────────────────────────────────────────────

export interface ReviewJob {
  id: string;
  snapshot_id: string | null;
  cycle_id: string | null;
  trigger_source: TriggerSource;
  trigger_policy_id: string | null;
  marketplace: Marketplace;
  review_type: ReviewType;
  status: JobStatus;
  priority: number;
  scheduled_for: string | null;
  requested_by: string | null;
  model_name: string | null;
  ocr_engine: string | null;
  attempt_count: number;
  max_attempts: number;
  started_at: string | null;
  completed_at: string | null;
  error_type: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Snapshot ─────────────────────────────────────────────────────────────────

export interface ReviewSnapshot {
  id: string;
  marketplace: Marketplace;
  listing_id: string;
  external_listing_id: string | null;
  shop_code: string | null;
  product_spu_id: string | null;
  product_family_id: string | null;
  is_hero_product: boolean;
  title: string | null;
  description: string | null;
  bullet_points_json: string[] | null;
  price: number | null;
  image_urls_json: string[] | null;
  product_facts_json: Record<string, unknown> | null;
  marketplace_status: string | null;
  source_hash: string;
  created_at: string;
}

// ─── Snapshot Image ───────────────────────────────────────────────────────────

export interface SnapshotImage {
  id: string;
  snapshot_id: string;
  image_index: number;
  image_url: string | null;
  source_asset_id: string | null;
  platform_image_id: string | null;
  is_main_image: boolean;
  url_hash: string | null;
  content_hash: string | null;
  http_status: number | null;
  width: number | null;
  height: number | null;
  byte_size: number | null;
  loaded: boolean;
  load_error: string | null;
  ocr_text: string | null;
  ocr_blocks_json: unknown[] | null;
  ocr_engine: string | null;
  created_at: string;
}

export interface SnapshotImageInput {
  image_index: number;
  image_url: string;
  source_asset_id?: string;
  platform_image_id?: string;
  is_main_image?: boolean;
}

// ─── Review Result ────────────────────────────────────────────────────────────

export interface ReviewResult {
  id: string;
  snapshot_id: string;
  job_id: string | null;
  review_type: ReviewType;
  model_name: string | null;
  ocr_engine: string | null;
  scoring_version: string | null;
  technical_score: number | null;
  content_score: number | null;
  image_score: number | null;
  compliance_score: number | null;
  conversion_score: number | null;
  operational_risk_score: number | null;
  final_score: number | null;
  confidence: Confidence;
  score_status: ScoreStatus;
  score_completeness_json: ScoreCompleteness;
  review_completeness: ReviewCompleteness | null;
  issues_json: QualityIssue[];
  recommendations_json: FixRecommendation[];
  raw_outputs_json: Record<string, unknown>;
  created_at: string;
}

// ─── Score Completeness ───────────────────────────────────────────────────────

export interface ScoreCompleteness {
  technical: boolean;
  ocr: boolean;
  marketplace_rules: boolean;
  qwen_visual: boolean;
  human_review: boolean;
}

// ─── Quality Issue ────────────────────────────────────────────────────────────

export interface QualityIssue {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  source: 'technical' | 'ocr' | 'marketplace_rule' | 'qwen_visual' | 'human';
  marketplace: Marketplace;
  affected_image_indexes: number[];
  evidence: string;
  operator_note: string;
  requires_human_approval: boolean;
  suggested_owner: string | null;
  expected_impact: string | null;
}

// ─── Fix Recommendation ───────────────────────────────────────────────────────

export type FixType =
  | 'replace_broken_image'
  | 'replace_weak_main_image'
  | 'reorder_images'
  | 'add_dimension_image'
  | 'add_lifestyle_image'
  | 'add_detail_closeup'
  | 'remove_risky_claim_text'
  | 'fix_variant_color_mismatch'
  | 'fix_product_count_mismatch'
  | 'rewrite_title'
  | 'rewrite_description'
  | 'update_bullet_points'
  | 'add_missing_product_facts'
  | 'human_review';

export interface FixRecommendation {
  fix_type: FixType;
  priority: 'low' | 'medium' | 'high' | 'critical';
  reason: string;
  affected_image_indexes: number[];
  requires_human_approval: boolean;
}

// ─── Image Health Check ───────────────────────────────────────────────────────

export interface ImageHealthResult {
  image_index: number;
  image_url: string;
  loaded: boolean;
  http_status: number | null;
  width: number | null;
  height: number | null;
  byte_size: number | null;
  content_hash: string | null;
  url_hash: string;
  load_error: string | null;
}

// ─── OCR Result ───────────────────────────────────────────────────────────────

export interface OcrResult {
  image_index: number;
  ocr_text: string;
  ocr_blocks: unknown[];
  ocr_engine: string;
  error: string | null;
}

// ─── Duplicate Detection ──────────────────────────────────────────────────────

export interface DuplicateGroup {
  image_indexes: number[];
  reason: 'url_match' | 'content_match';
}

// ─── Review Run Input ─────────────────────────────────────────────────────────

export interface ReviewRunInput {
  policy: ReviewPolicy;
  listing: {
    id: string;
    external_listing_id: string | null;
    marketplace: Marketplace;
    shop_code: string | null;
    title: string | null;
    description: string | null;
    bullet_points: string[] | null;
    price: number | null;
    status: string | null;
    product_spu_id: string | null;
    product_family_id: string | null;
    is_hero_product: boolean;
    product_facts: Record<string, unknown> | null;
  };
  images: SnapshotImageInput[];
}

// ─── Review Run Output ────────────────────────────────────────────────────────

export interface ReviewRunOutput {
  snapshot: ReviewSnapshot;
  snapshotImages: SnapshotImage[];
  /** null when the review was skipped (snapshot unchanged + already reviewed). */
  result: ReviewResult | null;
  /** null when the review was skipped. */
  job: ReviewJob | null;
  /** True when the snapshot was unchanged and already reviewed (skipped). */
  skipped?: boolean;
  /** Number of work items created/updated from this review (Phase 2). */
  workItemsCreated?: number;
  /** Number of work item creation errors (Phase 2). */
  workItemErrors?: number;
}

// ─── Job Options ──────────────────────────────────────────────────────────────

export interface TechnicalReviewOptions {
  dryRun: boolean;
  confirm: boolean;
  limit: number;
  platform?: Marketplace;
  verbose: boolean;
  /** Skip work item creation after review (Phase 2). */
  skipWorkItems?: boolean;
  /** Skip Qwen visual review (Phase 3). */
  skipQwen?: boolean;
}

// ─── Phase 2 Score Engine ───────────────────────────────────────────────────

/** Input to the deterministic score engine. */
export interface ScoreEngineInput {
  snapshotImages: SnapshotImage[];
  issues: QualityIssue[];
  marketplace: Marketplace;
  ocrSucceeded: boolean;
  /** Whether the Qwen visual review step completed successfully. */
  qwenSucceeded?: boolean;
  title: string | null;
  description: string | null;
  price: number | null;
}

/** Output from the deterministic score engine. */
export interface ScoreEngineOutput {
  technicalScore: number;
  imageScore: number;
  contentScore: number;
  complianceScore: number;
  conversionScore: number;
  operationalRiskScore: number;
  finalScore: number;
  scoreStatus: ScoreStatus;
  scoreCompleteness: ScoreCompleteness;
  computedDimensions: string[];
}

export type ScoreGrade = 'critical' | 'high' | 'medium' | 'low';

// ─── Phase 3: Qwen AI Visual Review Pipeline ──────────────────────────────

/** Input to the Qwen visual review pipeline step (Phase 3). */
export interface QwenPipelineInput {
  /** Loaded snapshot images with health check data. */
  snapshotImages: SnapshotImage[];
  marketplace: Marketplace;
  title: string | null;
  description: string | null;
  /** OCR text from loaded images, keyed by image_index. */
  ocrTextByIndex: Record<number, string>;
  /** Model name to use (default: qwen3.5:9b via Ollama). */
  modelName?: string;
}

/** Output from the Qwen visual review pipeline step. */
export interface QwenPipelineOutput {
  /** Qwen-detected issues (source: 'qwen_visual'). */
  issues: QualityIssue[];
  /** Raw Qwen response for audit trail (stored in raw_outputs_json). */
  rawOutput: Record<string, unknown>;
  /** Whether the Qwen call succeeded (false on timeout, model error, etc.). */
  succeeded: boolean;
  /** Error message if Qwen review failed. */
  errorMessage: string | null;
  /** Model that produced this output. */
  modelName: string | null;
  /** Wall-clock duration of the Qwen call in ms. */
  durationMs: number;
}

// ─── Phase 4: Marketplace Compliance Rule Engine ──────────────────────────

/** A single marketplace compliance rule definition. */
export interface MarketplaceComplianceRule {
  /** Unique rule ID, e.g. 'amazon_white_background'. */
  id: string;
  /** Which marketplace this rule applies to. */
  marketplace: Marketplace;
  /** Category this rule falls under. */
  category: 'image_compliance' | 'content_quality' | 'compliance' | 'operational';
  /** Issue type emitted when this rule is violated (must exist in taxonomy). */
  issueType: string;
  /** Default severity when violated. */
  defaultSeverity: 'low' | 'medium' | 'high' | 'critical';
  /** Human-readable description of what this rule checks. */
  description: string;
  /** Operator-facing note template ({pos}, {actual}, {expected} placeholders). */
  operatorNoteTemplate: string;
  /** Whether this rule may produce false positives (QC should verify). */
  requiresHumanApproval: boolean;
}

/** Result from running a single marketplace compliance rule. */
export interface MarketplaceRuleResult {
  /** Rule ID that was checked. */
  ruleId: string;
  /** Whether the listing passed (true) or violated (false) this rule. */
  passed: boolean;
  /** Quality issue if violated, null if passed. */
  issue: QualityIssue | null;
  /** Additional context for the operator (actual vs expected values). */
  context: Record<string, unknown>;
}

/** Result from running all marketplace compliance rules for a listing. */
export interface MarketplaceRuleRunOutput {
  marketplace: Marketplace;
  /** Total rules checked. */
  rulesChecked: number;
  /** Rules that passed. */
  rulesPassed: number;
  /** Violations found. */
  violations: MarketplaceRuleResult[];
  /** All issues extracted from violations (ready to merge into review). */
  issues: QualityIssue[];
}

// ─── Phase 3: Event-Triggered Re-review ──────────────────────────────────
// Per listing-quality-engineering-image-mvp-design.md § Phase 3.

/** Status lifecycle for a listing quality improvement cycle. */
export type CycleStatus =
  | 'not_reviewed'
  | 'review_queued'
  | 'reviewed'
  | 'fix_needed'
  | 'fix_in_progress'
  | 'fix_ready_for_review'
  | 're_review_queued'
  | 'improved'
  | 'approved'
  | 'published'
  | 'rejected'
  | 'deferred';

/** What triggered a re-review. */
export type ReReviewTriggerSource =
  | 'image_change'
  | 'title_change'
  | 'description_change'
  | 'product_facts_change'
  | 'work_item_completed'
  | 'new_listing_imported'
  | 'hero_promotion'
  | 'manual_request';

/** Tracks one improvement loop for a listing across review → fix → re-review. */
export interface ListingQualityCycle {
  id: string;
  listing_id: string;
  marketplace: Marketplace;
  cycle_status: CycleStatus;
  baseline_snapshot_id: string | null;
  latest_snapshot_id: string | null;
  baseline_score: number | null;
  latest_score: number | null;
  score_delta: number | null;
  created_from: ReReviewTriggerSource | null;
  human_owner: string | null;
  created_at: string;
  updated_at: string;
}
