#!/usr/bin/env python3
"""
Backfill Mercari listings from the Mercari Shops GraphQL API into
RPagentOS database tables (platform_listings, platform_listing_skus).

Intended to be run from the fixed-IP Conoha VPS.  Python stdlib only.

Usage:
  # Dry-run (default)
  python scripts/backfill_mercari_listings_from_api.py \\
      --shop-code shop1 --expected-shop-id <shop_id> [--report /tmp/report.json]

  # Apply (writes to database)
  python scripts/backfill_mercari_listings_from_api.py \\
      --shop-code shop1 --expected-shop-id <shop_id> --apply [--report /tmp/report.json]

Environment:
  MERCARI_ACCESS_TOKEN       Required.  Mercari Shops API personal access token.
  SUPABASE_URL               Required only for --apply and --read-audit.
  SUPABASE_SERVICE_ROLE_KEY  Required only for --apply and --read-audit.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
from collections.abc import Sequence
from datetime import datetime, timezone
from typing import Any

MERCARI_API = "https://api.mercari-shops.com/v1/graphql"
USER_AGENT = "Inhouse_ERP/0.1.0"
PAGE_SIZE = 50

STATUS_MAP = {
    "OPENED": "active",
    "ACTIVE": "active",
    "CLOSED": "inactive",
    "INACTIVE": "inactive",
    "SOLD_OUT": "sold_out",
    "DRAFT": "draft",
}

VALID_SHOP_CODES = frozenset({"shop1", "shop2", "shop3"})


# ─── helpers ──────────────────────────────────────────────────────────


def _fingerprint(text: str | None, length: int = 8) -> str:
    if not text:
        return "<empty>"
    return hashlib.sha256(text.encode()).hexdigest()[:length]


def _bounded_batch(items: list, size: int):
    for i in range(0, len(items), size):
        yield items[i : i + size]


# ─── GraphQL ──────────────────────────────────────────────────────────


def _graphql_request(
    query: str, variables: dict[str, Any] | None, token: str
) -> dict[str, Any]:
    body = json.dumps({"query": query, "variables": variables or {}}).encode()
    req = urllib.request.Request(
        MERCARI_API,
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            result: dict = json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode(errors="replace")
        raise RuntimeError(f"Mercari GraphQL HTTP {exc.code}: {raw[:500]}")
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Mercari GraphQL connection failed: {exc.reason}")

    if "errors" in result:
        msgs = [e.get("message", str(e)) for e in result["errors"]]
        raise RuntimeError(f"Mercari GraphQL errors: {'; '.join(msgs)}")

    return result.get("data", result)


def fetch_shop_id(token: str) -> str:
    data = _graphql_request("query { shop { id } }", None, token)
    sid = (data.get("shop") or {}).get("id")
    if not sid:
        raise RuntimeError("GraphQL shop query returned no id")
    return sid


def fetch_all_products(token: str) -> list[dict[str, Any]]:
    query = """
    query($after: String, $first: Int) {
      products(after: $after, first: $first) {
        edges { node { id name status shippingDuration
          variants { id skuCode stockQuantity } } }
        pageInfo { endCursor hasNextPage }
      }
    }
    """
    products: list[dict[str, Any]] = []
    cursor: str | None = None

    while True:
        data = _graphql_request(query, {"after": cursor, "first": PAGE_SIZE}, token)
        conn = data.get("products", {})
        edges = conn.get("edges", [])
        page_info = conn.get("pageInfo", {})
        if not edges:
            break
        for edge in edges:
            node = edge.get("node", {})
            if node.get("id"):
                products.append(node)
        if not page_info.get("hasNextPage"):
            break
        cursor = page_info.get("endCursor")

    if not products:
        raise RuntimeError("Zero products returned from Mercari API")

    return products


# ─── PostgREST helpers ────────────────────────────────────────────────


def _pg_headers(service_key: str) -> dict[str, str]:
    return {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
    }


def _pg_get(
    url: str, service_key: str
) -> list[dict[str, Any]]:
    req = urllib.request.Request(url, headers=_pg_headers(service_key), method="GET")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result: list = json.loads(resp.read().decode())
            return result
    except urllib.error.HTTPError as exc:
        body = exc.read().decode(errors="replace")
        raise RuntimeError(f"PostgREST GET {exc.code} for {url}: {body[:300]}")


def _pg_paginated_get(
    base_url: str, service_key: str, batch_size: int = 1000
) -> list[dict[str, Any]]:
    all_rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        url = f"{base_url}&offset={offset}&limit={batch_size}"
        rows = _pg_get(url, service_key)
        if not rows:
            break
        all_rows.extend(rows)
        if len(rows) < batch_size:
            break
        offset += batch_size
    return all_rows


def _pg_upsert(
    table: str,
    rows: list[dict[str, Any]],
    service_key: str,
    supabase_url: str,
    on_conflict: str,
    select: str = "id",
) -> list[dict[str, Any]]:
    if not rows:
        return []
    url = f"{supabase_url}/rest/v1/{table}?on_conflict={on_conflict}&select={select}"
    payload = json.dumps(rows).encode()
    hdrs = _pg_headers(service_key)
    hdrs["Prefer"] = "resolution=merge-duplicates,return=representation"
    req = urllib.request.Request(url, data=payload, headers=hdrs, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            result: list = json.loads(resp.read().decode())
            return result
    except urllib.error.HTTPError as exc:
        body = exc.read().decode(errors="replace")
        raise RuntimeError(f"PostgREST upsert {table} HTTP {exc.code}: {body[:500]}")


# ─── data fetching ───────────────────────────────────────────────────


def fetch_account(
    shop_code: str, supabase_url: str, service_key: str
) -> dict[str, Any]:
    url = (
        f"{supabase_url}/rest/v1/platform_accounts"
        f"?platform=eq.mercari"
        f"&shop_code=eq.{shop_code}"
        f"&status=eq.active"
        f"&select=id,shop_code,seller_account_id"
    )
    rows = _pg_get(url, service_key)
    if not rows:
        raise RuntimeError(
            f"No active platform_account found for mercari/{shop_code}"
        )
    return rows[0]


def fetch_variant_map(
    supabase_url: str, service_key: str,
) -> tuple[dict[str, str], int, int]:
    url = (
        f"{supabase_url}/rest/v1/product_variants"
        f"?select=id,item_code"
        f"&item_code=not.is.null"
        f"&order=item_code.asc"
    )
    rows = _pg_paginated_get(url, service_key, batch_size=1000)
    total = len(rows)
    mapping: dict[str, str] = {}
    for row in rows:
        ic = row.get("item_code")
        vid = row.get("id")
        if ic and vid:
            if ic in mapping:
                raise RuntimeError(
                    f"Duplicate item_code '{ic}' in product_variants "
                    f"(ids: {mapping[ic]}, {vid})"
                )
            mapping[ic] = vid
    return mapping, total, len(mapping)


def fetch_existing_listings(
    shop_code: str, supabase_url: str, service_key: str,
) -> dict[str, str]:
    url = (
        f"{supabase_url}/rest/v1/platform_listings"
        f"?select=id,external_listing_id"
        f"&platform=eq.mercari"
        f"&shop_code=eq.{shop_code}"
        f"&order=external_listing_id.asc"
    )
    rows = _pg_paginated_get(url, service_key, batch_size=1000)
    return {r["external_listing_id"]: r["id"] for r in rows if r.get("external_listing_id")}


# ─── normalisation ────────────────────────────────────────────────────


def _normalize_status(api_status: str | None) -> str:
    if not api_status:
        return "unknown"
    return STATUS_MAP.get(api_status.upper(), "unknown")


def validate_and_normalize(
    products: list[dict[str, Any]],
    variant_map: dict[str, str],
    shop_code: str,
    account_id: str | None,
    excluded_listing_ids: set[str] | None = None,
) -> tuple[
    list[dict[str, Any]],   # listing records (no listing_id yet)
    list[dict[str, Any]],   # sku stubs  (no listing_id yet)
    list[dict[str, Any]],   # unresolved SKU samples
    dict[str, int],         # external_listing_id → variant count
]:
    seen_external_ids: set[str] = set()
    listing_records: list[dict[str, Any]] = []
    sku_stubs: list[dict[str, Any]] = []
    unresolved_sample: list[dict[str, Any]] = []
    variant_counts: dict[str, int] = {}

    excluded_listing_ids = excluded_listing_ids or set()
    seen_exclusions: set[str] = set()
    for product in products:
        pid = product.get("id")
        if not pid:
            continue
        if pid in seen_external_ids:
            raise RuntimeError(
                f"Duplicate external listing ID '{pid}' in Mercari API response"
            )
        seen_external_ids.add(pid)

        variants = product.get("variants") or []
        codes = [(v.get("skuCode") or "").strip() for v in variants]
        invalid_for_mapping = (
            not variants
            or any(not code for code in codes)
            or len([code for code in codes if code])
            != len(set(code for code in codes if code))
        )
        if pid in excluded_listing_ids:
            if not invalid_for_mapping:
                raise RuntimeError(
                    f"Refusing to quarantine valid listing '{pid}'"
                )
            seen_exclusions.add(pid)
            continue
        if not variants:
            raise RuntimeError(f"Product '{pid}' has zero variants")
        variant_counts[pid] = len(variants)

        seen_sku_codes: set[str] = set()
        resolved_vids: set[str] = set()

        for v in variants:
            sc = (v.get("skuCode") or "").strip()
            if not sc:
                raise RuntimeError(f"Listing '{pid}' has an empty SKU code")
            if sc in seen_sku_codes:
                raise RuntimeError(
                    f"Listing '{pid}' has duplicate SKU code '{sc}'"
                )
            seen_sku_codes.add(sc)
            if sc in variant_map:
                resolved_vids.add(variant_map[sc])
            else:
                unresolved_sample.append({
                    "sku_code": sc,
                    "fingerprint": _fingerprint(sc),
                    "listing_id": pid,
                })

        variant_id = list(resolved_vids)[0] if len(resolved_vids) == 1 else None

        listing_records.append({
            "platform": "mercari",
            "shop_code": shop_code,
            "external_listing_id": pid,
            "platform_account_id": account_id,
            "title": (product.get("name") or "")[:500],
            "listing_status": _normalize_status(product.get("status")),
            "shipping_days": product.get("shippingDuration"),
            "variant_id": variant_id,
            "raw_payload": {
                "id": pid,
                "name": product.get("name"),
                "status": product.get("status"),
                "shippingDuration": product.get("shippingDuration"),
            },
        })

        for idx, v in enumerate(variants, start=1):
            sc = (v.get("skuCode") or "").strip()
            sku_stubs.append({
                "sku_position": idx,
                "external_sku_id": v.get("id"),
                "sku_code": sc or None,
                "seller_sku": sc or None,
                "stock_qty": v.get("stockQuantity", 0),
                "variant_id": variant_map.get(sc),
            })

    missing_exclusions = excluded_listing_ids - seen_exclusions
    if missing_exclusions:
        raise RuntimeError(
            "Requested quarantine listing IDs were not found: "
            + ", ".join(sorted(missing_exclusions))
        )

    return listing_records, sku_stubs, unresolved_sample, variant_counts


# ─── reporting ────────────────────────────────────────────────────────


def build_report(
    shop_code: str,
    mode: str,
    account: dict[str, Any] | None,
    shop_id: str | None,
    products: list[dict[str, Any]],
    variant_map: dict[str, str],
    total_variants_db: int,
    mapped_variants_db: int,
    listing_records: list[dict[str, Any]],
    sku_stubs: list[dict[str, Any]],
    unresolved: list[dict[str, Any]],
    existing_listing_map: dict[str, str] | None,
    created_listings: int = 0,
    updated_listings: int = 0,
    created_skus: int = 0,
    updated_skus: int = 0,
    errors: list[str] | None = None,
    quarantined_listing_ids: set[str] | None = None,
) -> dict[str, Any]:
    mercari_variant_count = sum(
        len(p.get("variants") or []) for p in products
    )
    listings_with_variant = sum(
        1 for lr in listing_records if lr.get("variant_id")
    )
    skus_with_variant = sum(
        1 for sr in sku_stubs if sr.get("variant_id")
    )

    report: dict[str, Any] = {
        "tool": "backfill_mercari_listings_from_api",
        "shop_code": shop_code,
        "mode": mode,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "account": {
            "id": account["id"] if account else None,
            "shop_code": shop_code,
        },
        "mercari_api": {
            "shop_id": shop_id,
            "products_count": len(products),
            "total_variants_count": mercari_variant_count,
        },
        "source_db": {
            "product_variants_count": total_variants_db,
            "product_variants_with_item_code": mapped_variants_db,
        },
        "candidates": {
            "listings": len(listing_records),
            "skus": len(sku_stubs),
            "listings_with_variant_id": listings_with_variant,
            "skus_with_variant_id": skus_with_variant,
        },
        "candidate_external_listing_ids": [
            row["external_listing_id"] for row in listing_records
        ],
        "unresolved_skus": unresolved[:20],
        "unresolved_sku_count": len(unresolved),
        "quarantined_listings": {
            "count": len(quarantined_listing_ids or set()),
            "fingerprints": sorted(
                _fingerprint(value, 12)
                for value in (quarantined_listing_ids or set())
            ),
        },
        "errors": errors or [],
    }

    if mode == "dry_run":
        report["existing"] = {
            "listings_count": len(existing_listing_map) if existing_listing_map else 0,
        }
    else:
        report["results"] = {
            "listings_created": created_listings,
            "listings_updated": updated_listings,
            "skus_created": created_skus,
            "skus_updated": updated_skus,
        }

    return report


def write_report(path: str, report: dict[str, Any]) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    print(f"Report: {path}")


# ─── main ─────────────────────────────────────────────────────────────


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Backfill Mercari listings from GraphQL API into RPagentOS",
    )
    parser.add_argument(
        "--shop-code",
        required=True,
        choices=sorted(VALID_SHOP_CODES),
    )
    parser.add_argument(
        "--expected-shop-id",
        required=True,
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        default=False,
        help="Apply upserts (default: dry-run)",
    )
    parser.add_argument(
        "--report",
        default=None,
        help="Write JSON report to this path",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=50,
        help="Upsert batch size (default: 50)",
    )
    parser.add_argument(
        "--exclude-listing-id",
        action="append",
        default=[],
        help=(
            "Explicitly quarantine a listing that has empty/duplicate SKU codes; "
            "may be repeated. Valid listings cannot be excluded."
        ),
    )
    return parser.parse_args(argv)


def main() -> int:
    args = parse_args()
    shop_code = args.shop_code
    expected_shop_id = args.expected_shop_id
    is_apply = args.apply
    report_path = args.report
    batch_size = args.batch_size
    excluded_listing_ids = set(args.exclude_listing_id)

    access_token = os.environ.get("MERCARI_ACCESS_TOKEN")
    if not access_token:
        print("FATAL: MERCARI_ACCESS_TOKEN is not set", file=sys.stderr)
        return 1

    supabase_url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if is_apply and (not supabase_url or not service_key):
        print(
            "FATAL: --apply requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
            file=sys.stderr,
        )
        return 1

    errors: list[str] = []
    account: dict[str, Any] | None = None
    shop_id: str | None = None
    products: list[dict[str, Any]] = []
    variant_map: dict[str, str] = {}
    total_variants_db = 0
    mapped_variants_db = 0
    listing_records: list[dict[str, Any]] = []
    sku_stubs: list[dict[str, Any]] = []
    unresolved: list[dict[str, Any]] = []
    variant_counts: dict[str, int] = {}
    existing_listing_map: dict[str, str] = {}

    try:
        # ── 1. Verify shop identity ────────────────────────────────
        print("[1/5] Verifying shop identity via GraphQL ... ", end="", flush=True)
        shop_id = fetch_shop_id(access_token)
        if shop_id != expected_shop_id:
            raise RuntimeError(
                f"Shop ID mismatch: expected '{expected_shop_id}', "
                f"GraphQL returned '{shop_id}'"
            )
        print(f"OK (id={shop_id})")

        # ── 2. Fetch platform_account ──────────────────────────────
        if supabase_url and service_key:
            print(
                f"[2/5] Fetching platform_account for '{shop_code}' ... ",
                end="", flush=True,
            )
            account = fetch_account(shop_code, supabase_url, service_key)
            print(f"OK (id={account['id']})")
        else:
            print("[2/5] Skipping platform_account (no Supabase credentials)")

        # ── 3. Build item_code→id map ──────────────────────────────
        if supabase_url and service_key:
            print(
                "[3/5] Building item_code→id map from product_variants ... ",
                end="", flush=True,
            )
            variant_map, total_variants_db, mapped_variants_db = fetch_variant_map(
                supabase_url, service_key
            )
            print(f"OK ({mapped_variants_db} mapped / {total_variants_db} total)")
        else:
            print("[3/5] Skipping variant map (no Supabase credentials)")

        # ── 4. Fetch products from Mercari ─────────────────────────
        print("[4/5] Fetching all products from Mercari GraphQL ... ", end="", flush=True)
        products = fetch_all_products(access_token)
        print(f"OK ({len(products)} products)")

        # ── 5. Normalize ───────────────────────────────────────────
        print("[5/5] Normalizing listings and SKUs ... ", end="", flush=True)
        listing_records, sku_stubs, unresolved, variant_counts = (
            validate_and_normalize(
                products, variant_map, shop_code,
                account["id"] if account else None,
                excluded_listing_ids,
            )
        )
        print(f"OK ({len(listing_records)} listings, {len(sku_stubs)} SKUs)")
        print()

        # ── Count existing data ────────────────────────────────────
        if supabase_url and service_key:
            existing_listing_map = fetch_existing_listings(
                shop_code, supabase_url, service_key
            )

        listing_ext_ids = [lr["external_listing_id"] for lr in listing_records]
        preexisting_listing_ids = set(existing_listing_map)
        new_count = sum(1 for eid in listing_ext_ids if eid not in existing_listing_map)
        upd_count = sum(1 for eid in listing_ext_ids if eid in existing_listing_map)

        print(f"  Existing listings in DB:      {len(existing_listing_map)}")
        print(f"  New listings to create:       {new_count}")
        print(f"  Existing listings to update:  {upd_count}")
        print(f"  Total SKUs to upsert:         {len(sku_stubs)}")
        if excluded_listing_ids:
            print(f"  Explicitly quarantined:       {len(excluded_listing_ids)}")
        if unresolved:
            print(f"  Unresolved SKUs:              {len(unresolved)}")
            for s in unresolved[:5]:
                print(f"    - {s['sku_code']}  (fp={s['fingerprint']})")
            if len(unresolved) > 5:
                print(f"    ... and {len(unresolved) - 5} more")

        # ── Apply ──────────────────────────────────────────────────
        created_listings_total = 0
        updated_listings_total = 0
        created_skus_total = 0

        if is_apply:
            if not supabase_url or not service_key:
                print("FATAL: --apply requires credentials", file=sys.stderr)
                return 1

            print("\nApplying upserts ...")

            # Upsert listings in batches
            for batch in _bounded_batch(listing_records, batch_size):
                returned = _pg_upsert(
                    "platform_listings",
                    batch,
                    service_key,
                    supabase_url,
                    on_conflict="platform,shop_code,external_listing_id",
                    select="id,external_listing_id",
                )
                for row in returned:
                    eid = row.get("external_listing_id") or ""
                    rid = row.get("id") or ""
                    if eid:
                        existing_listing_map[eid] = rid

            # Re-count to determine created vs updated
            post_listing_map = fetch_existing_listings(
                shop_code, supabase_url, service_key
            )
            created_listings_total = sum(
                1 for eid in listing_ext_ids if eid not in preexisting_listing_ids
            )
            updated_listings_total = sum(
                1 for eid in listing_ext_ids if eid in preexisting_listing_ids
            )
            if any(eid not in post_listing_map for eid in listing_ext_ids):
                raise RuntimeError("Post-apply listing readback is incomplete")
            existing_listing_map = post_listing_map

            # Build SKU records with actual listing UUIDs
            sku_records: list[dict[str, Any]] = []
            sku_idx = 0
            for lr in listing_records:
                eid = lr["external_listing_id"]
                uuid = existing_listing_map.get(eid)
                if not uuid:
                    continue
                vc = variant_counts.get(eid, 0)
                for _ in range(vc):
                    stub = sku_stubs[sku_idx]
                    sku_records.append({
                        "listing_id": uuid,
                        "sku_position": stub["sku_position"],
                        "external_sku_id": stub["external_sku_id"],
                        "sku_code": stub["sku_code"],
                        "seller_sku": stub["seller_sku"],
                        "stock_qty": stub["stock_qty"],
                        "variant_id": stub["variant_id"],
                    })
                    sku_idx += 1

            for batch in _bounded_batch(sku_records, batch_size):
                _pg_upsert(
                    "platform_listing_skus",
                    batch,
                    service_key,
                    supabase_url,
                    on_conflict="listing_id,sku_position",
                )
            created_skus_total = len(sku_records)

            print(f"  Listings: {updated_listings_total} updated, "
                  f"{created_listings_total} created")
            print(f"  SKUs:     {created_skus_total} upserted")

        # ── Build and emit report ──────────────────────────────────
        report = build_report(
            shop_code=shop_code,
            mode="apply" if is_apply else "dry_run",
            account=account,
            shop_id=shop_id,
            products=products,
            variant_map=variant_map,
            total_variants_db=total_variants_db,
            mapped_variants_db=mapped_variants_db,
            listing_records=listing_records,
            sku_stubs=sku_stubs,
            unresolved=unresolved,
            existing_listing_map=existing_listing_map,
            created_listings=created_listings_total,
            updated_listings=updated_listings_total,
            created_skus=created_skus_total,
            updated_skus=0,
            errors=errors or None,
            quarantined_listing_ids=excluded_listing_ids,
        )

        mode_label = "DRY-RUN" if not is_apply else "APPLY"
        print(f"\n[{mode_label}] Backfill complete. "
              f"{len(listing_records)} listings, {len(sku_stubs)} SKUs.")

    except RuntimeError as exc:
        print(f"\nFAILED: {exc}", file=sys.stderr)
        errors.append(str(exc))
        report = build_report(
            shop_code=shop_code,
            mode="apply" if is_apply else "dry_run",
            account=account,
            shop_id=shop_id,
            products=products,
            variant_map=variant_map,
            total_variants_db=total_variants_db,
            mapped_variants_db=mapped_variants_db,
            listing_records=listing_records,
            sku_stubs=sku_stubs,
            unresolved=unresolved,
            existing_listing_map=existing_listing_map,
            errors=errors,
            quarantined_listing_ids=excluded_listing_ids,
        )
        if report_path:
            write_report(report_path, report)
        return 1

    if report_path:
        write_report(report_path, report)

    return 0


if __name__ == "__main__":
    sys.exit(main())
