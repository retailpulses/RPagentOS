-- Domain: product_catalog
-- Owner: retailpulses/RPagentOS
-- Affected: platform_account_monthly_metrics
-- Change class: data
-- Hosted write required: yes
-- Consumers: none
-- Issue: https://github.com/retailpulses/RPagentOS/issues/70
-- Ownership registry: https://github.com/retailpulses/rp-governance-kit/issues/49
--
-- Forward recovery: correct bad source rows with a new, reviewed data migration;
-- never rewrite this historical migration after it has been applied.
-- Rollback: delete only rows whose source_system is
-- 'mercari_seller_dashboard_monthly_csv' and whose source_file is one of the
-- four exact filenames seeded below. Existing conflicting rows are preserved
-- by ON CONFLICT DO NOTHING and therefore are not rollback targets.

do $$
declare
  matched_account_count integer;
begin
  select count(*) into matched_account_count
  from platform_accounts
  where platform = 'mercari'
    and shop_code in ('shop1', 'shop2', 'shop3', 'shop4');

  if matched_account_count <> 4 then
    raise exception
      'Expected exactly four Mercari platform_accounts for shop1/shop2/shop3/shop4; found %',
      matched_account_count;
  end if;
end
$$;

with source_rows (
  shop_code,
  source_file,
  source_row_number,
  month_label,
  period_start,
  coverage_status,
  sales_amount,
  visitor_count,
  raw_conversion_text,
  reported_conversion_rate,
  average_purchase_value,
  new_follower_count,
  extra_quality_flags
) as (
  values
    ('shop4', 'shop4 monthly_metrics.csv', 2, '2026年8月', date '2026-08-01', 'partial', 1512518::numeric, 31768::bigint, '0.00', 0.00::numeric, 13626::numeric, 153::bigint, '{}'::text[]),
    ('shop4', 'shop4 monthly_metrics.csv', 3, '2026年7月', date '2026-07-01', 'complete', 2191473::numeric, 47844::bigint, '0.00', 0.00::numeric, 12451::numeric, 279::bigint, '{}'::text[]),
    ('shop4', 'shop4 monthly_metrics.csv', 4, '2026年6月', date '2026-06-01', 'complete', 3521207::numeric, 48360::bigint, '0.00', 0.00::numeric, 13595::numeric, 372::bigint, '{}'::text[]),
    ('shop4', 'shop4 monthly_metrics.csv', 5, '2026年5月', date '2026-05-01', 'complete', 3689232::numeric, 62001::bigint, '0.00', 0.00::numeric, 14189::numeric, 422::bigint, '{}'::text[]),
    ('shop4', 'shop4 monthly_metrics.csv', 6, '2026年4月', date '2026-04-01', 'complete', 3193891::numeric, 59090::bigint, '0.00', 0.00::numeric, 13707::numeric, 374::bigint, '{}'::text[]),
    ('shop4', 'shop4 monthly_metrics.csv', 7, '2026年3月', date '2026-03-01', 'complete', 2543614::numeric, 44988::bigint, '0.00', 0.00::numeric, 15997::numeric, 238::bigint, '{}'::text[]),
    ('shop4', 'shop4 monthly_metrics.csv', 8, '2026年2月', date '2026-02-01', 'complete', 137540::numeric, 6691::bigint, '0.00', 0.00::numeric, 12503::numeric, 18::bigint, '{}'::text[]),
    ('shop4', 'shop4 monthly_metrics.csv', 9, '2026年1月', date '2026-01-01', 'unknown', 0::numeric, 0::bigint, '0.00', 0.00::numeric, 0::numeric, 0::bigint, array['all_zero_metrics_review_required']::text[]),

    ('shop1', 'shop1 monthly_metrics (1).csv', 2, '2026年6月', date '2026-06-01', 'complete', 626052::numeric, 16522::bigint, '0.00', 0.00::numeric, 16052::numeric, 117::bigint, '{}'::text[]),
    ('shop1', 'shop1 monthly_metrics (1).csv', 3, '2026年5月', date '2026-05-01', 'complete', 662695::numeric, 17484::bigint, '0.00', 0.00::numeric, 13253::numeric, 103::bigint, '{}'::text[]),
    ('shop1', 'shop1 monthly_metrics (1).csv', 4, '2026年4月', date '2026-04-01', 'complete', 935914::numeric, 18923::bigint, '0.00', 0.00::numeric, 15095::numeric, 116::bigint, '{}'::text[]),
    ('shop1', 'shop1 monthly_metrics (1).csv', 5, '2026年3月', date '2026-03-01', 'complete', 1474283::numeric, 27904::bigint, '0.00', 0.00::numeric, 15043::numeric, 181::bigint, '{}'::text[]),
    ('shop1', 'shop1 monthly_metrics (1).csv', 6, '2026年2月', date '2026-02-01', 'complete', 1574433::numeric, 33005::bigint, '0.00', 0.00::numeric, 14853::numeric, 200::bigint, '{}'::text[]),
    ('shop1', 'shop1 monthly_metrics (1).csv', 7, '2026年1月', date '2026-01-01', 'complete', 1791522::numeric, 44798::bigint, '0.00', 0.00::numeric, 16286::numeric, 211::bigint, '{}'::text[]),
    ('shop1', 'shop1 monthly_metrics (1).csv', 8, '2025年12月', date '2025-12-01', 'complete', 2873216::numeric, 16434::bigint, '0.01', 0.01::numeric, 17413::numeric, 319::bigint, '{}'::text[]),
    ('shop1', 'shop1 monthly_metrics (1).csv', 9, '2025年11月', date '2025-11-01', 'complete', 2314502::numeric, 43402::bigint, '0.00', 0.00::numeric, 16414::numeric, 240::bigint, '{}'::text[]),
    ('shop1', 'shop1 monthly_metrics (1).csv', 10, '2025年10月', date '2025-10-01', 'complete', 1504848::numeric, 28145::bigint, '0.00', 0.00::numeric, 14331::numeric, 144::bigint, '{}'::text[]),
    ('shop1', 'shop1 monthly_metrics (1).csv', 11, '2025年9月', date '2025-09-01', 'complete', 1211707::numeric, 24092::bigint, '0.00', 0.00::numeric, 14089::numeric, 104::bigint, '{}'::text[]),
    ('shop1', 'shop1 monthly_metrics (1).csv', 12, '2025年8月', date '2025-08-01', 'complete', 338525::numeric, 12370::bigint, '0.00', 0.00::numeric, 12537::numeric, 27::bigint, '{}'::text[]),
    ('shop1', 'shop1 monthly_metrics (1).csv', 13, '2025年7月', date '2025-07-01', 'complete', 457202::numeric, 11638::bigint, '0.00', 0.00::numeric, 16933::numeric, 39::bigint, '{}'::text[]),
    ('shop1', 'shop1 monthly_metrics (1).csv', 14, '2025年6月', date '2025-06-01', 'complete', 258270::numeric, 8434::bigint, '0.00', 0.00::numeric, 15192::numeric, 27::bigint, '{}'::text[]),

    ('shop2', 'shop2 monthly_metrics (1).csv', 2, '2026年7月', date '2026-07-01', 'complete', 455146::numeric, 17970::bigint, '0.00', 0.00::numeric, 11378::numeric, 52::bigint, '{}'::text[]),
    ('shop2', 'shop2 monthly_metrics (1).csv', 3, '2026年6月', date '2026-06-01', 'complete', 460086::numeric, 18533::bigint, '0.00', 0.00::numeric, 13531::numeric, 106::bigint, '{}'::text[]),
    ('shop2', 'shop2 monthly_metrics (1).csv', 4, '2026年5月', date '2026-05-01', 'complete', 583198::numeric, 29461::bigint, '0.00', 0.00::numeric, 11902::numeric, 116::bigint, '{}'::text[]),
    ('shop2', 'shop2 monthly_metrics (1).csv', 5, '2026年4月', date '2026-04-01', 'complete', 1535495::numeric, 41492::bigint, '0.00', 0.00::numeric, 13237::numeric, 179::bigint, '{}'::text[]),
    ('shop2', 'shop2 monthly_metrics (1).csv', 6, '2026年3月', date '2026-03-01', 'complete', 1967205::numeric, 50665::bigint, '0.00', 0.00::numeric, 12529::numeric, 262::bigint, '{}'::text[]),
    ('shop2', 'shop2 monthly_metrics (1).csv', 7, '2026年2月', date '2026-02-01', 'complete', 893466::numeric, 29361::bigint, '0.00', 0.00::numeric, 11603::numeric, 156::bigint, '{}'::text[]),
    ('shop2', 'shop2 monthly_metrics (1).csv', 8, '2026年1月', date '2026-01-01', 'complete', 1057929::numeric, 37117::bigint, '0.00', 0.00::numeric, 10795::numeric, 190::bigint, '{}'::text[]),
    ('shop2', 'shop2 monthly_metrics (1).csv', 9, '2025年12月', date '2025-12-01', 'complete', 2232119::numeric, 14004::bigint, '0.01', 0.01::numeric, 12000::numeric, 313::bigint, '{}'::text[]),
    ('shop2', 'shop2 monthly_metrics (1).csv', 10, '2025年11月', date '2025-11-01', 'complete', 1443836::numeric, 24278::bigint, '0.00', 0.00::numeric, 12777::numeric, 185::bigint, '{}'::text[]),
    ('shop2', 'shop2 monthly_metrics (1).csv', 11, '2025年10月', date '2025-10-01', 'complete', 902641::numeric, 14918::bigint, '0.00', 0.00::numeric, 13886::numeric, 97::bigint, '{}'::text[]),
    ('shop2', 'shop2 monthly_metrics (1).csv', 12, '2025年9月', date '2025-09-01', 'complete', 899900::numeric, 15803::bigint, '0.00', 0.00::numeric, 11998::numeric, 81::bigint, '{}'::text[]),
    ('shop2', 'shop2 monthly_metrics (1).csv', 13, '2025年8月', date '2025-08-01', 'complete', 970620::numeric, 16290::bigint, '0.00', 0.00::numeric, 15406::numeric, 89::bigint, '{}'::text[]),

    ('shop3', 'shop3 montly_metrics (1).csv', 2, '2026年7月', date '2026-07-01', 'complete', 774735::numeric, 24327::bigint, '0.00', 0.00::numeric, 13357::numeric, 105::bigint, '{}'::text[]),
    ('shop3', 'shop3 montly_metrics (1).csv', 3, '2026年6月', date '2026-06-01', 'complete', 431684::numeric, 19859::bigint, '0.00', 0.00::numeric, 11667::numeric, 78::bigint, '{}'::text[]),
    ('shop3', 'shop3 montly_metrics (1).csv', 4, '2026年5月', date '2026-05-01', 'complete', 900393::numeric, 27898::bigint, '0.00', 0.00::numeric, 13852::numeric, 123::bigint, '{}'::text[]),
    ('shop3', 'shop3 montly_metrics (1).csv', 5, '2026年4月', date '2026-04-01', 'complete', 1673720::numeric, 41392::bigint, '0.00', 0.00::numeric, 14681::numeric, 213::bigint, '{}'::text[]),
    ('shop3', 'shop3 montly_metrics (1).csv', 6, '2026年3月', date '2026-03-01', 'complete', 2524519::numeric, 56859::bigint, '0.00', 0.00::numeric, 13217::numeric, 351::bigint, '{}'::text[]),
    ('shop3', 'shop3 montly_metrics (1).csv', 7, '2026年2月', date '2026-02-01', 'complete', 798078::numeric, 32112::bigint, '0.00', 0.00::numeric, 12872::numeric, 179::bigint, '{}'::text[]),
    ('shop3', 'shop3 montly_metrics (1).csv', 8, '2026年1月', date '2026-01-01', 'complete', 1332031::numeric, 44655::bigint, '0.00', 0.00::numeric, 12333::numeric, 224::bigint, '{}'::text[]),
    ('shop3', 'shop3 montly_metrics (1).csv', 9, '2025年12月', date '2025-12-01', 'complete', 1339971::numeric, 10421::bigint, '0.01', 0.01::numeric, 12293::numeric, 230::bigint, '{}'::text[]),
    ('shop3', 'shop3 montly_metrics (1).csv', 10, '2025年11月', date '2025-11-01', 'unknown', 0::numeric, 0::bigint, '0.00', 0.00::numeric, 0::numeric, 0::bigint, array['all_zero_metrics_review_required']::text[]),
    ('shop3', 'shop3 montly_metrics (1).csv', 11, '2025年10月', date '2025-10-01', 'unknown', 0::numeric, 0::bigint, '0.00', 0.00::numeric, 0::numeric, 0::bigint, array['all_zero_metrics_review_required']::text[]),
    ('shop3', 'shop3 montly_metrics (1).csv', 12, '2025年9月', date '2025-09-01', 'unknown', 0::numeric, 0::bigint, '0.00', 0.00::numeric, 0::numeric, 0::bigint, array['all_zero_metrics_review_required']::text[]),
    ('shop3', 'shop3 montly_metrics (1).csv', 13, '2025年8月', date '2025-08-01', 'unknown', 0::numeric, 0::bigint, '0.00', 0.00::numeric, 0::numeric, 0::bigint, array['all_zero_metrics_review_required']::text[]),
    ('shop3', 'shop3 montly_metrics (1).csv', 14, '2025年7月', date '2025-07-01', 'unknown', 0::numeric, 0::bigint, '0.00', 0.00::numeric, 0::numeric, 0::bigint, array['all_zero_metrics_review_required']::text[])
),
prepared as (
  select
    account.id as platform_account_id,
    source.period_start,
    (source.period_start + interval '1 month - 1 day')::date as period_end,
    date '2026-08-24' as source_as_of_date,
    source.coverage_status,
    coalesce(account.default_currency, 'JPY') as currency,
    source.sales_amount,
    source.visitor_count,
    source.reported_conversion_rate,
    false as reported_conversion_rate_reliable,
    source.average_purchase_value,
    source.new_follower_count,
    'mercari_seller_dashboard_monthly_csv'::text as source_system,
    source.source_file,
    source.source_row_number,
    array['reported_conversion_rate_low_precision',
          'estimated_conversion_from_sales_and_average_purchase_value']::text[]
      || case
           when source.reported_conversion_rate = 0
             then array['reported_conversion_rate_precision_loss_suspected']::text[]
           else '{}'::text[]
         end
      || source.extra_quality_flags as quality_flags,
    jsonb_build_object(
      '月', source.month_label,
      '売上', source.sales_amount,
      '訪問者数', source.visitor_count,
      '転換率', source.raw_conversion_text,
      '購入単価', source.average_purchase_value,
      '新規フォロー数', source.new_follower_count
    ) as raw_payload
  from source_rows source
  join platform_accounts account
    on account.platform = 'mercari'
   and account.shop_code = source.shop_code
)
insert into platform_account_monthly_metrics (
  platform_account_id,
  period_start,
  period_end,
  source_as_of_date,
  coverage_status,
  currency,
  sales_amount,
  visitor_count,
  reported_conversion_rate,
  reported_conversion_rate_reliable,
  average_purchase_value,
  new_follower_count,
  source_system,
  source_file,
  source_row_number,
  quality_flags,
  raw_payload
)
select
  platform_account_id,
  period_start,
  period_end,
  source_as_of_date,
  coverage_status,
  currency,
  sales_amount,
  visitor_count,
  reported_conversion_rate,
  reported_conversion_rate_reliable,
  average_purchase_value,
  new_follower_count,
  source_system,
  source_file,
  source_row_number,
  quality_flags,
  raw_payload
from prepared
on conflict (platform_account_id, period_start, source_system) do nothing;

do $$
declare
  seeded_row_count integer;
begin
  select count(*) into seeded_row_count
  from platform_account_monthly_metrics metrics
  join platform_accounts account on account.id = metrics.platform_account_id
  where account.platform = 'mercari'
    and account.shop_code in ('shop1', 'shop2', 'shop3', 'shop4')
    and metrics.source_system = 'mercari_seller_dashboard_monthly_csv'
    and metrics.source_file in (
      'shop1 monthly_metrics (1).csv',
      'shop2 monthly_metrics (1).csv',
      'shop3 montly_metrics (1).csv',
      'shop4 monthly_metrics.csv'
    );

  if seeded_row_count <> 46 then
    raise exception 'Expected 46 seeded monthly metric rows; found %', seeded_row_count;
  end if;
end
$$;
