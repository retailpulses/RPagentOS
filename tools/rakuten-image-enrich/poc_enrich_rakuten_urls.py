#!/usr/bin/env python3
"""POC: Enrich Rakuten relative image_path → full image_url in platform_listing_images.

Verifies the CDN URL pattern with a few sample rows before full scale.
Pattern: https://shop.r10s.jp/{shop_code}/cabinet{image_path}
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

# Add project root to find .env.cloud.local
PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))

from dotenv import load_dotenv
load_dotenv(PROJECT_ROOT / ".env.cloud.local")

from supabase import create_client, Client

SHOP_CODE = "homebliss"
CDN_BASE = f"https://shop.r10s.jp/{SHOP_CODE}/cabinet"
POC_LIMIT = 5  # number of rows to test


def get_supabase() -> Client:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set in .env.cloud.local")
    return create_client(url, key)


def build_full_url(image_path: str) -> str:
    """Convert relative path to full CDN URL."""
    # image_path is like /13189040/imgrc0136130896.jpg
    # Result: https://shop.r10s.jp/homebliss/cabinet/13189040/imgrc0136130896.jpg
    return f"{CDN_BASE}{image_path}"


def main():
    supabase = get_supabase()

    # 1. Fetch sample rows with image_path but no image_url
    resp = (
        supabase.table("platform_listing_images")
        .select("id,listing_id,image_position,image_path,image_url")
        .eq("source", "rakuten")
        .not_.is_("image_path", "null")
        .is_("image_url", "null")
        .limit(POC_LIMIT)
        .execute()
    )

    rows = resp.data or []
    print(f"POC: Testing {len(rows)} sample rows from platform_listing_images")
    print(f"CDN base: {CDN_BASE}")
    print()

    # 2. Build full URLs and verify with HEAD requests
    updates = []
    for row in rows:
        full_url = build_full_url(row["image_path"])
        row_id = row["id"]
        pos = row["image_position"]
        path = row["image_path"]

        # Verify URL works
        import urllib.request
        try:
            req = urllib.request.Request(full_url, method="HEAD")
            with urllib.request.urlopen(req, timeout=10) as r:
                status = r.status
        except urllib.error.HTTPError as e:
            status = e.code
        except Exception as e:
            status = f"ERROR: {e}"

        print(f"  id={row_id} pos={pos} path={path}")
        print(f"    → {full_url}")
        print(f"    HTTP {status}")

        updates.append({
            "id": row_id,
            "listing_id": row["listing_id"],
            "image_position": pos,
            "image_url": full_url,
        })

    # 3. Ask for confirmation before writing
    print()
    print(f"Ready to write {len(updates)} rows to Supabase.")
    ans = input("Proceed with POC write? [y/N]: ").strip().lower()
    if ans != "y":
        print("Aborted.")
        return

    # 4. Upsert (idempotent — sets image_url only)
    resp = (
        supabase.table("platform_listing_images")
        .upsert(updates, on_conflict="listing_id,image_position")
        .execute()
    )
    if hasattr(resp, "error") and resp.error:
        print(f"ERROR: {resp.error}")
        return

    print(f"✅ POC complete: {len(updates)} rows updated with full CDN URLs.")

    # 5. Verify reads back
    print()
    print("Verifying reads...")
    ids = [u["id"] for u in updates]
    verify = (
        supabase.table("platform_listing_images")
        .select("id,image_url")
        .in_("id", ids)
        .execute()
    )
    for v in (verify.data or []):
        print(f"  id={v['id']} url={v['image_url'][:80]}...")


if __name__ == "__main__":
    main()
