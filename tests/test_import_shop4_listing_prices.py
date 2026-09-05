import csv
import importlib.util
import sys
from decimal import Decimal
from pathlib import Path

import pytest


SCRIPT = Path(__file__).parents[1] / "scripts" / "import_shop4_listing_prices.py"
spec = importlib.util.spec_from_file_location("shop4_importer", SCRIPT)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


def write_csv(path, rows):
    headers = ["処理フラグ", "商品ID", "現在価格", "値引き前の価格", "SKU1_商品管理コード"]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows)


def test_load_csv_skips_template_and_preserves_prices(tmp_path):
    path = tmp_path / "prices.csv"
    write_csv(path, [
        {"処理フラグ": "# CREATE", "商品ID": "fake", "現在価格": "500", "値引き前の価格": "500", "SKU1_商品管理コード": "fake"},
        {"処理フラグ": "UPDATE", "商品ID": "live-1", "現在価格": "11410", "値引き前の価格": "10839", "SKU1_商品管理コード": "SKU-1"},
    ])
    rows = module.load_csv(path)
    assert rows == [module.PriceInput("live-1", "SKU-1", Decimal("11410"), Decimal("10839"))]


def test_load_csv_rejects_duplicate_listing_id(tmp_path):
    path = tmp_path / "prices.csv"
    row = {"処理フラグ": "UPDATE", "商品ID": "same", "現在価格": "100", "値引き前の価格": "90", "SKU1_商品管理コード": "SKU"}
    write_csv(path, [row, row])
    with pytest.raises(module.ImportFailure, match="duplicate 商品ID"):
        module.load_csv(path)


def test_verify_reports_missing_and_changed():
    items = [
        module.PriceInput("a", "A", Decimal("100"), Decimal("90")),
        module.PriceInput("b", "B", Decimal("200"), Decimal("180")),
    ]
    actual = {"a": {"current_price": "100", "mercari_before_discount_price": "91"}}
    assert module.verify(items, actual) == ["a", "b"]
