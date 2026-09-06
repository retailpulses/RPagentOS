from pathlib import Path


MIGRATION = Path(__file__).parents[1] / "supabase" / "migrations" / "20260906060000_expose_mercari_listing_prices_to_catalogsync.sql"


def test_price_projection_is_additive_and_shop_isolated():
    sql = MIGRATION.read_text(encoding="utf-8")

    assert "catalogsync_mercari_shop4_listing_map_v1" in sql
    assert "catalogsync_mercari_listing_map_v1" in sql
    assert sql.count("listing.current_price") == 2
    assert sql.count("listing.mercari_before_discount_price") == 2
    assert "WHEN 'catalogsync_shop1_reader' THEN 'shop1'" in sql
    assert "WHEN 'catalogsync_shop2_reader' THEN 'shop2'" in sql
    assert "WHEN 'catalogsync_shop3_reader' THEN 'shop3'" in sql
    assert "lower(btrim(account.shop_code)) = 'shop4'" in sql
    assert "GRANT SELECT ON public.catalogsync_mercari_shop4_listing_map_v1" in sql
    assert "TO catalogsync_shop4_reader" in sql
