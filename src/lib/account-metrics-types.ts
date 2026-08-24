export interface PlatformAccountMetricAccount {
  id: string;
  platform: string;
  shop_code: string;
  display_name: string | null;
  currency: string;
}

export interface PlatformAccountMonthlyMetric {
  id: string;
  platform_account_id: string;
  period_start: string;
  period_end: string;
  source_as_of_date: string | null;
  coverage_status: 'complete' | 'partial' | 'prelaunch' | 'missing' | 'unknown';
  currency: string;
  sales_amount: number;
  visitor_count: number;
  reported_conversion_rate: number | null;
  reported_conversion_rate_reliable: boolean;
  average_purchase_value: number;
  new_follower_count: number;
  estimated_purchaser_count: number | null;
  estimated_conversion_rate: number | null;
  quality_flags: string[];
}

export interface AccountMetricsResponse {
  accounts: PlatformAccountMetricAccount[];
  metrics: PlatformAccountMonthlyMetric[];
}

