#!/usr/bin/env python3
"""Import Mercari Shops listing prices from official CSV exports.

Dry-run is the default. This owner-side utility writes only
platform_listings.current_price and mercari_before_discount_price.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Iterable


REQUIRED_COLUMNS = {"処理フラグ", "商品ID", "現在価格", "値引き前の価格"}


class ImportFailure(RuntimeError):
    pass


@dataclass(frozen=True)
class PriceInput:
    external_listing_id: str
    seller_sku: str
    current_price: Decimal
    mercari_before_discount_price: Decimal


def parse_positive_price(raw: str, *, field: str, line: int) -> Decimal:
    try:
        value = Decimal(raw.strip())
    except (InvalidOperation, AttributeError) as exc:
        raise ImportFailure(f"line {line}: invalid {field}: {raw!r}") from exc
    if not value.is_finite() or value <= 0:
        raise ImportFailure(f"line {line}: {field} must be positive: {raw!r}")
    return value


def load_csv(paths: list[Path]) -> list[PriceInput]:
    result: list[PriceInput] = []
    seen: set[str] = set()
    for path in paths:
        result.extend(_load_one_csv(path, seen))
    if not result:
        raise ImportFailure("CSV contains no importable rows")
    return result


def _load_one_csv(path: Path, seen: set[str]) -> list[PriceInput]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        missing = REQUIRED_COLUMNS - set(reader.fieldnames or ())
        if missing:
            raise ImportFailure(f"missing CSV columns: {sorted(missing)}")
        result: list[PriceInput] = []
        for line, row in enumerate(reader, start=2):
            if (row.get("処理フラグ") or "").strip().startswith("#"):
                continue
            listing_id = (row.get("商品ID") or "").strip()
            if not listing_id:
                raise ImportFailure(f"line {line}: 商品ID is empty")
            if listing_id in seen:
                raise ImportFailure(f"{path.name} line {line}: duplicate 商品ID {listing_id}")
            seen.add(listing_id)
            result.append(
                PriceInput(
                    external_listing_id=listing_id,
                    seller_sku=(row.get("SKU1_商品管理コード") or "").strip(),
                    current_price=parse_positive_price(row["現在価格"], field="現在価格", line=line),
                    mercari_before_discount_price=parse_positive_price(
                        row["値引き前の価格"], field="値引き前の価格", line=line
                    ),
                )
            )
    return result


class PostgrestClient:
    def __init__(self, base_url: str, service_key: str, shop_code: str) -> None:
        self.url = base_url.rstrip("/") + "/rest/v1/platform_listings"
        self.headers = {"apikey": service_key, "Authorization": f"Bearer {service_key}"}
        self.shop_filters = {"platform": "eq.mercari", "shop_code": f"eq.{shop_code}"}
        self.request_count = 0
        self.response_bytes = 0

    def request(self, *, query: dict[str, str], method: str = "GET", body: dict | None = None) -> list[dict]:
        headers = dict(self.headers)
        data = None
        if body is not None:
            headers.update({"Content-Type": "application/json", "Prefer": "return=representation"})
            data = json.dumps(body).encode()
        request = urllib.request.Request(
            self.url + "?" + urllib.parse.urlencode(query), headers=headers, data=data, method=method
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read()
        self.request_count += 1
        self.response_bytes += len(raw)
        return json.loads(raw)

    def read(self, ids: Iterable[str]) -> dict[str, dict]:
        ids = list(ids)
        result: dict[str, dict] = {}
        for start in range(0, len(ids), 100):
            batch = ids[start : start + 100]
            rows = self.request(
                query={
                    "select": "id,external_listing_id,current_price,mercari_before_discount_price",
                    **self.shop_filters,
                    "external_listing_id": "in.(" + ",".join(batch) + ")",
                }
            )
            for row in rows:
                listing_id = row["external_listing_id"]
                if listing_id in result:
                    raise ImportFailure(f"duplicate Shop4 listing in Supabase: {listing_id}")
                result[listing_id] = row
        return result

    def update(self, item: PriceInput) -> dict:
        rows = self.request(
            method="PATCH",
            query={**self.shop_filters, "external_listing_id": f"eq.{item.external_listing_id}"},
            body={
                "current_price": str(item.current_price),
                "mercari_before_discount_price": str(item.mercari_before_discount_price),
            },
        )
        if len(rows) != 1:
            raise ImportFailure(f"update affected {len(rows)} rows for {item.external_listing_id}")
        return rows[0]


def decimal_or_none(value: object) -> Decimal | None:
    return None if value is None else Decimal(str(value))


def differs(item: PriceInput, row: dict) -> bool:
    return (
        decimal_or_none(row.get("current_price")) != item.current_price
        or decimal_or_none(row.get("mercari_before_discount_price"))
        != item.mercari_before_discount_price
    )


def verify(inputs: list[PriceInput], rows: dict[str, dict]) -> list[str]:
    return [item.external_listing_id for item in inputs if item.external_listing_id not in rows or differs(item, rows[item.external_listing_id])]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Dry-run or import Mercari Shops prices from CSV")
    parser.add_argument("--shop-code", required=True, choices=("shop1", "shop2", "shop3", "shop4"))
    parser.add_argument("--csv", required=True, action="append", type=Path, help="Repeat for multiple same-shop CSV files")
    parser.add_argument("--apply", action="store_true", help="Perform Supabase writes")
    parser.add_argument("--max-changes", type=int, help="Required with --apply; exact upper safety bound")
    parser.add_argument("--canary-count", type=int, default=5)
    parser.add_argument("--exclude-listing-id", action="append", default=[], help="Explicit non-product CSV ID to exclude")
    parser.add_argument("--report", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.apply and (args.max_changes is None or args.max_changes < 0):
        raise ImportFailure("--apply requires non-negative --max-changes")
    if args.canary_count < 0:
        raise ImportFailure("--canary-count must be non-negative")
    base_url = os.environ.get("SUPABASE_URL", "")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not base_url or not service_key:
        raise ImportFailure("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")

    inputs = load_csv(args.csv)
    requested_exclusions = set(args.exclude_listing_id)
    unknown_exclusions = requested_exclusions - {item.external_listing_id for item in inputs}
    if unknown_exclusions:
        raise ImportFailure(f"excluded listing IDs are not present in CSV input: {sorted(unknown_exclusions)}")
    excluded = [item for item in inputs if item.external_listing_id in requested_exclusions]
    inputs = [item for item in inputs if item.external_listing_id not in requested_exclusions]
    if not inputs:
        raise ImportFailure("all CSV rows were excluded")
    by_id = {item.external_listing_id: item for item in inputs}
    client = PostgrestClient(base_url, service_key, args.shop_code)
    before = client.read(by_id)
    missing = sorted(set(by_id) - set(before))
    if missing:
        raise ImportFailure(f"{len(missing)} listing IDs not found: {missing[:10]}")
    changes = [item for item in inputs if differs(item, before[item.external_listing_id])]
    if args.apply and len(changes) > args.max_changes:
        raise ImportFailure(f"change count {len(changes)} exceeds --max-changes {args.max_changes}")

    report = {
        "mode": "apply" if args.apply else "dry_run",
        "shop_code": args.shop_code,
        "csv_files": [path.name for path in args.csv],
        "excluded": [asdict(item) for item in excluded],
        "csv_rows": len(inputs),
        "matched_listings": len(before),
        "changes": len(changes),
        "unchanged": len(inputs) - len(changes),
        "updated": 0,
        "verified": 0,
        "change_examples": [asdict(item) for item in changes[:10]],
    }

    if args.apply:
        canaries = changes[: args.canary_count]
        remainder = changes[args.canary_count :]
        for item in canaries:
            client.update(item)
        if verify(canaries, client.read(item.external_listing_id for item in canaries)):
            raise ImportFailure("canary readback failed")
        for item in remainder:
            client.update(item)
        report["updated"] = len(changes)
        failures = verify(inputs, client.read(by_id))
        if failures:
            raise ImportFailure(f"final readback failed for {len(failures)} listings: {failures[:10]}")
        report["verified"] = len(inputs)

    report["postgrest_requests"] = client.request_count
    report["response_bytes"] = client.response_bytes
    rendered = json.dumps(report, ensure_ascii=False, indent=2, default=str)
    print(rendered)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(rendered + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ImportFailure, OSError, urllib.error.URLError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
