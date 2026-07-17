"""Unit tests for scripts/backfill_mercari_listings_from_api.py."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch, PropertyMock

# ── ensure the script module is importable ──────────────────────────

_SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_SCRIPT = os.path.join(_SCRIPT_DIR, "scripts", "backfill_mercari_listings_from_api.py")

import importlib.util
spec = importlib.util.spec_from_file_location(
    "backfill_mercari_listings_from_api", _SCRIPT
)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

B = mod
sys.modules["backfill_mercari_listings_from_api"] = mod


class TestFingerprint(unittest.TestCase):
    def test_empty(self):
        self.assertEqual(B._fingerprint(""), "<empty>")

    def test_none(self):
        self.assertEqual(B._fingerprint(None), "<empty>")

    def test_sha256_prefix(self):
        fp = B._fingerprint("hello")
        self.assertEqual(len(fp), 8)
        self.assertTrue(all(c in "0123456789abcdef" for c in fp))

    def test_deterministic(self):
        self.assertEqual(B._fingerprint("abc"), B._fingerprint("abc"))


class TestNormalizeStatus(unittest.TestCase):
    def test_active(self):
        self.assertEqual(B._normalize_status("ACTIVE"), "active")

    def test_inactive(self):
        self.assertEqual(B._normalize_status("INACTIVE"), "inactive")

    def test_sold_out(self):
        self.assertEqual(B._normalize_status("SOLD_OUT"), "sold_out")

    def test_draft(self):
        self.assertEqual(B._normalize_status("DRAFT"), "draft")

    def test_lowercase_input(self):
        self.assertEqual(B._normalize_status("active"), "active")

    def test_none(self):
        self.assertEqual(B._normalize_status(None), "unknown")

    def test_empty(self):
        self.assertEqual(B._normalize_status(""), "unknown")

    def test_unknown_value(self):
        self.assertEqual(B._normalize_status("UNKNOWN_STATUS"), "unknown")


class TestValidateAndNormalize(unittest.TestCase):
    def test_explicit_quarantine_allows_only_invalid_listing(self):
        products = [{"id": "bad", "variants": [{"id": "v", "skuCode": ""}]}]
        listings, skus, unresolved, counts = B.validate_and_normalize(
            products, {}, "shop1", "account", {"bad"}
        )
        self.assertEqual((listings, skus, unresolved, counts), ([], [], [], {}))

    def test_explicit_quarantine_rejects_valid_listing(self):
        products = [{"id": "good", "variants": [{"id": "v", "skuCode": "SKU"}]}]
        with self.assertRaisesRegex(RuntimeError, "Refusing to quarantine valid"):
            B.validate_and_normalize(products, {}, "shop1", "account", {"good"})

    def test_explicit_quarantine_rejects_unknown_listing(self):
        with self.assertRaisesRegex(RuntimeError, "were not found"):
            B.validate_and_normalize([], {}, "shop1", "account", {"missing"})

    def setUp(self):
        self.variant_map = {"SKU001": "v1", "SKU002": "v2"}
        self.products = [
            {
                "id": "prod1",
                "name": "Test Product 1",
                "price": 1000,
                "status": "ACTIVE",
                "shippingDuration": "1-2日",
                "description": "Desc",
                "condition": "used",
                "createdAt": "2026-01-01T00:00:00Z",
                "updatedAt": "2026-01-02T00:00:00Z",
                "variants": [
                    {"id": "v_ext1", "skuCode": "SKU001", "stockQuantity": 5},
                    {"id": "v_ext2", "skuCode": "SKU002", "stockQuantity": 3},
                ],
            },
        ]

    def test_multiple_resolved_variants_no_listing_variant(self):
        """Multiple variants resolve -> listing.variant_id is None."""
        listings, skus, unresolved, vc = B.validate_and_normalize(
            self.products, self.variant_map, "shop1", "acct1"
        )
        self.assertEqual(len(listings), 1)
        self.assertEqual(len(skus), 2)
        self.assertIsNone(listings[0]["variant_id"])

    def test_single_resolved_variant_sets_listing_variant(self):
        """Only one variant resolves -> listing.variant_id = that id."""
        vm = {"SKU001": "v1"}
        listings, skus, unresolved, vc = B.validate_and_normalize(
            self.products, vm, "shop1", "acct1"
        )
        self.assertEqual(listings[0]["variant_id"], "v1")

    def test_no_resolved_variants(self):
        """No variants match -> listing.variant_id is None."""
        listings, skus, unresolved, vc = B.validate_and_normalize(
            self.products, {}, "shop1", "acct1"
        )
        self.assertIsNone(listings[0]["variant_id"])

    def test_duplicate_external_id(self):
        """Duplicate external listing ID raises."""
        products = self.products + [self.products[0]]
        with self.assertRaises(RuntimeError) as ctx:
            B.validate_and_normalize(products, self.variant_map, "shop1", "acct1")
        self.assertIn("Duplicate external listing ID", str(ctx.exception))

    def test_zero_variants(self):
        """Product with no variants raises."""
        products = [{"id": "p1", "name": "No variants", "variants": []}]
        with self.assertRaises(RuntimeError) as ctx:
            B.validate_and_normalize(products, {}, "shop1", "acct1")
        self.assertIn("zero variants", str(ctx.exception).lower())

    def test_duplicate_sku_code(self):
        """Duplicate SKU code within a listing raises."""
        products = [{
            "id": "p1",
            "name": "Dup",
            "variants": [
                {"id": "v1", "skuCode": "SKU001"},
                {"id": "v2", "skuCode": "SKU001"},
            ],
        }]
        with self.assertRaises(RuntimeError) as ctx:
            B.validate_and_normalize(products, {}, "shop1", "acct1")
        self.assertIn("duplicate sku code", str(ctx.exception).lower())

    def test_unresolved_sku_fingerprinted(self):
        """Unresolved SKUs get a fingerprint."""
        vm = {"SKU002": "v2"}
        listings, skus, unresolved, vc = B.validate_and_normalize(
            self.products, vm, "shop1", "acct1"
        )
        self.assertEqual(len(unresolved), 1)
        self.assertEqual(unresolved[0]["sku_code"], "SKU001")
        self.assertIn("fingerprint", unresolved[0])
        self.assertEqual(unresolved[0]["listing_id"], "prod1")

    def test_sku_stubs_have_correct_shape(self):
        """Each SKU stub has the expected keys."""
        listings, skus, unresolved, vc = B.validate_and_normalize(
            self.products, self.variant_map, "shop1", "acct1"
        )
        for s in skus:
            for key in ("sku_position", "external_sku_id", "sku_code",
                        "seller_sku", "stock_qty", "variant_id"):
                self.assertIn(key, s)

    def test_variant_counts_dict(self):
        """Returns external_listing_id -> variant count mapping."""
        listings, skus, unresolved, vc = B.validate_and_normalize(
            self.products, self.variant_map, "shop1", "acct1"
        )
        self.assertEqual(vc, {"prod1": 2})


class TestBuildReport(unittest.TestCase):
    def test_dry_run_mode(self):
        report = B.build_report(
            shop_code="shop1",
            mode="dry_run",
            account={"id": "acct1"},
            shop_id="shop_id_1",
            products=[{"id": "p1", "variants": [{"id": "v1"}]}],
            variant_map={"SKU001": "v1"},
            total_variants_db=10,
            mapped_variants_db=8,
            listing_records=[{"variant_id": "v1", "external_listing_id": "p1"}],
            sku_stubs=[{"variant_id": "v1"}],
            unresolved=[],
            existing_listing_map={"existing1": "uuid1"},
        )
        self.assertEqual(report["mode"], "dry_run")
        self.assertEqual(report["existing"]["listings_count"], 1)

    def test_apply_mode(self):
        report = B.build_report(
            shop_code="shop1",
            mode="apply",
            account={"id": "acct1"},
            shop_id="shop_id_1",
            products=[{"id": "p1", "variants": [{"id": "v1"}]}],
            variant_map={"SKU001": "v1"},
            total_variants_db=10,
            mapped_variants_db=8,
            listing_records=[{"variant_id": "v1", "external_listing_id": "p1"}],
            sku_stubs=[{"variant_id": "v1"}],
            unresolved=[],
            existing_listing_map={},
            created_listings=2,
            updated_listings=1,
            created_skus=5,
            updated_skus=0,
        )
        self.assertEqual(report["mode"], "apply")
        self.assertEqual(report["results"]["listings_created"], 2)
        self.assertEqual(report["results"]["listings_updated"], 1)

    def test_errors_in_report(self):
        report = B.build_report(
            shop_code="shop1", mode="dry_run",
            account=None, shop_id=None, products=[], variant_map={},
            total_variants_db=0, mapped_variants_db=0,
            listing_records=[], sku_stubs=[], unresolved=[],
            existing_listing_map={}, errors=["Something went wrong"],
        )
        self.assertEqual(report["errors"], ["Something went wrong"])

    def test_unresolved_truncated_to_20(self):
        unresolved = [{"sku_code": f"SKU{i:03d}"} for i in range(25)]
        report = B.build_report(
            shop_code="shop1", mode="dry_run",
            account=None, shop_id=None, products=[], variant_map={},
            total_variants_db=0, mapped_variants_db=0,
            listing_records=[], sku_stubs=[], unresolved=unresolved,
            existing_listing_map={},
        )
        self.assertEqual(len(report["unresolved_skus"]), 20)
        self.assertEqual(report["unresolved_sku_count"], 25)

    def test_report_no_secrets(self):
        report = B.build_report(
            shop_code="shop1", mode="dry_run",
            account={"id": "acct1", "shop_code": "shop1"},
            shop_id="shop_id_1", products=[], variant_map={},
            total_variants_db=0, mapped_variants_db=0,
            listing_records=[], sku_stubs=[], unresolved=[],
            existing_listing_map={},
        )
        s = json.dumps(report).lower()
        for secret in ("service_role", "access_token", "supabase_url",
                       "supabase_service_role_key", "mercari_access_token"):
            self.assertNotIn(secret, s)


class TestFetchShopId(unittest.TestCase):
    @patch.object(B, "_graphql_request")
    def test_success(self, mock_gql):
        mock_gql.return_value = {"shop": {"id": "shop_abc123"}}
        result = B.fetch_shop_id("test_token")
        self.assertEqual(result, "shop_abc123")

    @patch.object(B, "_graphql_request")
    def test_no_id(self, mock_gql):
        mock_gql.return_value = {"shop": {}}
        with self.assertRaises(RuntimeError) as ctx:
            B.fetch_shop_id("test_token")
        self.assertIn("no id", str(ctx.exception).lower())


class TestFetchAllProducts(unittest.TestCase):
    @patch.object(B, "_graphql_request")
    def test_single_page(self, mock_gql):
        mock_gql.return_value = {
            "products": {
                "edges": [
                    {"node": {"id": "p1", "name": "P1", "variants": []}},
                    {"node": {"id": "p2", "name": "P2", "variants": []}},
                ],
                "pageInfo": {"endCursor": "cur2", "hasNextPage": False},
            }
        }
        result = B.fetch_all_products("token")
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["id"], "p1")

    @patch.object(B, "_graphql_request")
    def test_multi_page(self, mock_gql):
        mock_gql.side_effect = [
            {
                "products": {
                    "edges": [{"node": {"id": "p1", "variants": []}}],
                    "pageInfo": {"endCursor": "cur1", "hasNextPage": True},
                }
            },
            {
                "products": {
                    "edges": [{"node": {"id": "p2", "variants": []}}],
                    "pageInfo": {"endCursor": "cur2", "hasNextPage": False},
                }
            },
        ]
        result = B.fetch_all_products("token")
        self.assertEqual(len(result), 2)
        self.assertEqual(mock_gql.call_count, 2)

    @patch.object(B, "_graphql_request")
    def test_zero_products_raises(self, mock_gql):
        mock_gql.return_value = {"products": {"edges": [], "pageInfo": {}}}
        with self.assertRaises(RuntimeError) as ctx:
            B.fetch_all_products("token")
        self.assertIn("zero products", str(ctx.exception).lower())


class TestGraphqlRequest(unittest.TestCase):
    @patch.object(B.urllib.request, "urlopen")
    def test_success(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({
            "data": {"shop": {"id": "sid"}}
        }).encode()
        mock_urlopen.return_value.__enter__.return_value = mock_resp
        result = B._graphql_request("query { shop { id } }", None, "test_token")
        self.assertEqual(result["shop"]["id"], "sid")

    @patch.object(B.urllib.request, "urlopen")
    def test_graphql_errors(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({
            "errors": [{"message": "field not found"}]
        }).encode()
        mock_urlopen.return_value.__enter__.return_value = mock_resp
        with self.assertRaises(RuntimeError) as ctx:
            B._graphql_request("query { invalid }", None, "token")
        self.assertIn("field not found", str(ctx.exception))

    @patch.object(B.urllib.request, "urlopen")
    def test_http_error(self, mock_urlopen):
        resp = MagicMock()
        resp.read.return_value = b"unauthorized"
        exc = B.urllib.error.HTTPError(
            url="http://example.com", code=401, msg="Unauthorized",
            hdrs={}, fp=resp,
        )
        mock_urlopen.side_effect = exc
        with self.assertRaises(RuntimeError) as ctx:
            B._graphql_request("query { shop { id } }", None, "bad_token")
        self.assertIn("HTTP 401", str(ctx.exception))


class TestFetchAccount(unittest.TestCase):
    @patch.object(B, "_pg_get")
    def test_success(self, mock_get):
        mock_get.return_value = [{"id": "acct1", "shop_code": "shop1"}]
        result = B.fetch_account("shop1", "https://supabase.co", "sk")
        self.assertEqual(result["id"], "acct1")

    @patch.object(B, "_pg_get")
    def test_not_found(self, mock_get):
        mock_get.return_value = []
        with self.assertRaises(RuntimeError) as ctx:
            B.fetch_account("shop1", "https://supabase.co", "sk")
        self.assertIn("no active platform_account", str(ctx.exception).lower())


class TestFetchVariantMap(unittest.TestCase):
    @patch.object(B, "_pg_paginated_get")
    def test_success(self, mock_get):
        mock_get.return_value = [
            {"id": "v1", "item_code": "SKU001"},
            {"id": "v2", "item_code": "SKU002"},
        ]
        mapping, total, mapped = B.fetch_variant_map("https://supabase.co", "sk")
        self.assertEqual(mapping, {"SKU001": "v1", "SKU002": "v2"})
        self.assertEqual(total, 2)
        self.assertEqual(mapped, 2)

    @patch.object(B, "_pg_paginated_get")
    def test_duplicate_item_code(self, mock_get):
        mock_get.return_value = [
            {"id": "v1", "item_code": "SKU001"},
            {"id": "v2", "item_code": "SKU001"},
        ]
        with self.assertRaises(RuntimeError) as ctx:
            B.fetch_variant_map("https://supabase.co", "sk")
        self.assertIn("duplicate item_code", str(ctx.exception).lower())

    @patch.object(B, "_pg_paginated_get")
    def test_none_item_code_skipped(self, mock_get):
        mock_get.return_value = [
            {"id": "v1", "item_code": None},
            {"id": "v2", "item_code": "SKU002"},
        ]
        mapping, total, mapped = B.fetch_variant_map("https://supabase.co", "sk")
        self.assertEqual(mapping, {"SKU002": "v2"})
        self.assertEqual(mapped, 1)


class TestBoundedBatch(unittest.TestCase):
    def test_exact_multiple(self):
        batches = list(B._bounded_batch([1, 2, 3, 4], 2))
        self.assertEqual(batches, [[1, 2], [3, 4]])

    def test_partial_last(self):
        batches = list(B._bounded_batch([1, 2, 3], 2))
        self.assertEqual(batches, [[1, 2], [3]])

    def test_empty(self):
        batches = list(B._bounded_batch([], 10))
        self.assertEqual(batches, [])

    def test_single_element(self):
        batches = list(B._bounded_batch([1], 2))
        self.assertEqual(batches, [[1]])


class TestPgUpsert(unittest.TestCase):
    @patch.object(B.urllib.request, "urlopen")
    def test_success(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps([
            {"id": "uuid1", "external_listing_id": "p1"},
        ]).encode()
        mock_urlopen.return_value.__enter__.return_value = mock_resp
        result = B._pg_upsert(
            "platform_listings",
            [{"external_listing_id": "p1"}],
            "sk", "https://supabase.co",
            on_conflict="platform,shop_code,external_listing_id",
            select="id,external_listing_id",
        )
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["id"], "uuid1")

    @patch.object(B.urllib.request, "urlopen")
    def test_empty_rows(self, mock_urlopen):
        result = B._pg_upsert(
            "platform_listings", [], "sk", "https://supabase.co",
            on_conflict="id",
        )
        self.assertEqual(result, [])
        mock_urlopen.assert_not_called()


class TestPgPaginatedGet(unittest.TestCase):
    @patch.object(B, "_pg_get")
    def test_single_page(self, mock_get):
        mock_get.return_value = [{"id": 1}, {"id": 2}]
        result = B._pg_paginated_get(
            "https://supabase.co/rest/v1/table?select=id",
            "sk", batch_size=1000,
        )
        self.assertEqual(len(result), 2)

    @patch.object(B, "_pg_get")
    def test_multi_page(self, mock_get):
        mock_get.side_effect = [
            [{"id": i} for i in range(1000)],
            [{"id": i} for i in range(1000, 1500)],
        ]
        result = B._pg_paginated_get(
            "https://supabase.co/rest/v1/table?select=id",
            "sk", batch_size=1000,
        )
        self.assertEqual(len(result), 1500)
        self.assertEqual(mock_get.call_count, 2)


class TestParseArgs(unittest.TestCase):
    def test_minimal(self):
        args = B.parse_args([
            "--shop-code", "shop1", "--expected-shop-id", "sid123",
        ])
        self.assertEqual(args.shop_code, "shop1")
        self.assertEqual(args.expected_shop_id, "sid123")
        self.assertFalse(args.apply)

    def test_apply_flag(self):
        args = B.parse_args([
            "--shop-code", "shop2", "--expected-shop-id", "sid", "--apply",
        ])
        self.assertTrue(args.apply)

    def test_report_path(self):
        args = B.parse_args([
            "--shop-code", "shop3", "--expected-shop-id", "sid",
            "--report", "/tmp/r.json",
        ])
        self.assertEqual(args.report, "/tmp/r.json")

    def test_custom_batch_size(self):
        args = B.parse_args([
            "--shop-code", "shop1", "--expected-shop-id", "sid",
            "--batch-size", "25",
        ])
        self.assertEqual(args.batch_size, 25)

    def test_invalid_shop_code(self):
        with self.assertRaises(SystemExit):
            B.parse_args([
                "--shop-code", "shop4", "--expected-shop-id", "sid",
            ])


class TestReportWriting(unittest.TestCase):
    def test_write_report(self):
        report = {"tool": "test", "mode": "dry_run"}
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False
        ) as f:
            path = f.name
        try:
            B.write_report(path, report)
            with open(path) as f:
                loaded = json.load(f)
            self.assertEqual(loaded["tool"], "test")
        finally:
            os.unlink(path)


class TestMainDryRun(unittest.TestCase):
    @patch.dict(
        os.environ,
        {"MERCARI_ACCESS_TOKEN": "tok", "SUPABASE_URL": "https://db",
         "SUPABASE_SERVICE_ROLE_KEY": "sk"},
        clear=True,
    )
    @patch.object(B, "fetch_shop_id")
    @patch.object(B, "fetch_account")
    @patch.object(B, "fetch_variant_map")
    @patch.object(B, "fetch_all_products")
    @patch.object(B, "fetch_existing_listings")
    def test_dry_run_flow(
        self,
        mock_fetch_existing,
        mock_fetch_products,
        mock_variant_map,
        mock_account,
        mock_shop_id,
    ):
        mock_shop_id.return_value = "expected_shop"
        mock_account.return_value = {"id": "acct1", "shop_code": "shop1"}
        mock_variant_map.return_value = ({"SKU001": "v1"}, 1, 1)
        mock_fetch_products.return_value = [
            {
                "id": "mercari_p1",
                "name": "Test",
                "status": "ACTIVE",
                "variants": [
                    {"id": "var1", "skuCode": "SKU001", "stockQuantity": 5},
                ],
            },
        ]
        mock_fetch_existing.return_value = {}

        with patch.object(
            sys, "argv", [
                "prog", "--shop-code", "shop1", "--expected-shop-id",
                "expected_shop",
            ]
        ):
            exit_code = B.main()

        self.assertEqual(exit_code, 0)
        mock_shop_id.assert_called_once_with("tok")
        mock_account.assert_called_once()
        mock_variant_map.assert_called_once()
        mock_fetch_products.assert_called_once_with("tok")
        mock_fetch_existing.assert_called_once_with("shop1", "https://db", "sk")


class TestMainApply(unittest.TestCase):
    @patch.dict(
        os.environ,
        {"MERCARI_ACCESS_TOKEN": "tok", "SUPABASE_URL": "https://db",
         "SUPABASE_SERVICE_ROLE_KEY": "sk"},
        clear=True,
    )
    @patch.object(B, "fetch_shop_id")
    @patch.object(B, "fetch_account")
    @patch.object(B, "fetch_variant_map")
    @patch.object(B, "fetch_all_products")
    @patch.object(B, "fetch_existing_listings")
    @patch.object(B, "_pg_upsert")
    def test_apply_flow(
        self,
        mock_upsert,
        mock_fetch_existing,
        mock_fetch_products,
        mock_variant_map,
        mock_account,
        mock_shop_id,
    ):
        mock_shop_id.return_value = "expected_shop"
        mock_account.return_value = {"id": "acct1", "shop_code": "shop1"}
        mock_variant_map.return_value = ({"SKU001": "v1"}, 1, 1)
        mock_fetch_products.return_value = [
            {
                "id": "mercari_p1",
                "name": "Test",
                "status": "ACTIVE",
                "variants": [
                    {"id": "var1", "skuCode": "SKU001", "stockQuantity": 5},
                ],
            },
        ]
        mock_fetch_existing.side_effect = [
            {},
            {"mercari_p1": "existing_uuid"},
        ]
        mock_upsert.return_value = [
            {"id": "listing_uuid_1", "external_listing_id": "mercari_p1"}
        ]

        with patch.object(
            sys, "argv", [
                "prog", "--shop-code", "shop1", "--expected-shop-id",
                "expected_shop", "--apply",
            ]
        ):
            exit_code = B.main()

        self.assertEqual(exit_code, 0)
        self.assertGreaterEqual(mock_upsert.call_count, 1)

    @patch.dict(
        os.environ,
        {"MERCARI_ACCESS_TOKEN": "tok", "SUPABASE_URL": "https://db",
         "SUPABASE_SERVICE_ROLE_KEY": "sk"},
        clear=True,
    )
    @patch.object(B, "fetch_shop_id")
    @patch.object(B, "fetch_account")
    @patch.object(B, "fetch_variant_map")
    @patch.object(B, "fetch_all_products")
    @patch.object(B, "fetch_existing_listings")
    def test_apply_without_flag_is_dry_run(
        self,
        mock_fetch_existing,
        mock_fetch_products,
        mock_variant_map,
        mock_account,
        mock_shop_id,
    ):
        mock_shop_id.return_value = "expected_shop"
        mock_account.return_value = {"id": "acct1", "shop_code": "shop1"}
        mock_variant_map.return_value = ({"SKU001": "v1"}, 1, 1)
        mock_fetch_products.return_value = [
            {
                "id": "mercari_p1",
                "name": "Test",
                "status": "ACTIVE",
                "variants": [
                    {"id": "var1", "skuCode": "SKU001", "stockQuantity": 5},
                ],
            },
        ]
        mock_fetch_existing.return_value = {}

        with patch.object(
            sys, "argv", [
                "prog", "--shop-code", "shop1", "--expected-shop-id",
                "expected_shop",
            ]
        ):
            exit_code = B.main()
        self.assertEqual(exit_code, 0)


class TestMainErrors(unittest.TestCase):
    def test_missing_access_token(self):
        with patch.dict(os.environ, {}, clear=True):
            with patch.object(
                sys, "argv", [
                    "prog", "--shop-code", "shop1", "--expected-shop-id", "sid",
                ]
            ):
                exit_code = B.main()
                self.assertEqual(exit_code, 1)

    def test_shop_id_mismatch(self):
        with patch.dict(
            os.environ,
            {"MERCARI_ACCESS_TOKEN": "tok"},
            clear=True,
        ):
            with patch.object(
                B, "fetch_shop_id", return_value="wrong_shop",
            ):
                with patch.object(
                    sys, "argv", [
                        "prog", "--shop-code", "shop1", "--expected-shop-id", "sid",
                    ]
                ):
                    exit_code = B.main()
                    self.assertEqual(exit_code, 1)

    def test_apply_without_credentials(self):
        with patch.dict(
            os.environ,
            {"MERCARI_ACCESS_TOKEN": "tok"},
            clear=True,
        ):
            with patch.object(B, "fetch_shop_id", return_value="sid"):
                with patch.object(
                    sys, "argv", [
                        "prog", "--shop-code", "shop1", "--expected-shop-id",
                        "sid", "--apply",
                    ]
                ):
                    exit_code = B.main()
                    self.assertEqual(exit_code, 1)

    def test_invalid_shop_code(self):
        with patch.dict(
            os.environ, {"MERCARI_ACCESS_TOKEN": "tok"}, clear=True,
        ):
            with patch.object(
                sys, "argv", [
                    "prog", "--shop-code", "shop4", "--expected-shop-id", "sid",
                ]
            ):
                with self.assertRaises(SystemExit):
                    B.main()


if __name__ == "__main__":
    unittest.main()
