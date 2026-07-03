export type ListingAuditPlatform = 'mercari' | 'rakuten' | 'amazon' | 'shopify' | 'unknown';

export type ListingAuditPriority = 'low' | 'medium' | 'high';

export type ListingAuditActionType =
  | 'no_action'
  | 'rewrite'
  | 'manual_review'
  | 'price_check'
  | 'image_fix';

export interface ListingAuditInput {
  listingId: string;
  platform: ListingAuditPlatform;
  shopCode?: string;
  sku?: string;
  title: string;
  description?: string;
  price?: number;
  stockQty?: number;
  listingStatus?: string;
  category?: string;
  url?: string;
  imageUrls?: string[];
  raw: Record<string, unknown>;
}

export interface ListingAuditSection {
  score: number;
  issues: string[];
}

export interface ListingAuditResult {
  listingId: string;
  platform: ListingAuditPlatform;
  shopCode?: string;
  sku?: string;
  overallScore: number;
  titleQuality: ListingAuditSection & {
    suggestedTitle: string;
  };
  descriptionQuality: ListingAuditSection & {
    suggestedDescription: string;
  };
  imageQuality: ListingAuditSection;
  pricingRisk: {
    level: ListingAuditPriority;
    reason: string;
  };
  actionRecommendation: {
    type: ListingAuditActionType;
    priority: ListingAuditPriority;
    reason: string;
  };
  humanReviewRequired: boolean;
  sourceSnapshot: ListingAuditInput;
  auditedAt: string;
}

export interface ListingAuditBatchSummary {
  total: number;
  audited: number;
  actionCounts: Record<ListingAuditActionType, number>;
  priorityCounts: Record<ListingAuditPriority, number>;
  averageScore: number;
}

export interface ListingAuditBatchResult {
  summary: ListingAuditBatchSummary;
  results: ListingAuditResult[];
}
