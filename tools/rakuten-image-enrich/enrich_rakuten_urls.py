#!/usr/bin/env python3
"""Enrich Rakuten relative image_path → full image_url in platform_listing_images.

Pattern: https://image.rakuten.co.jp/{shop_code}/cabinet{image_path}
- Uses image.rakuten.co.jp (the <base> tag domain on Rakuten product pages)
- Idempotent: skips rows that already have image_url
- Batched upsert: 500 rows per call to stay under request size limits
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))

from dotenv import load_dotenv
load_dotenv(PROJECT_ROOT / ".env.cloud.local")

from supabase import create_client, Client

SHOP_CODE = "homebliss"
CDN_BASE = f"https://image.rakuten.co.jp/{SHOP_CODE}/cabinet"
BATCH_SIZE = 500


def log(msg: str):
    print(msg, flush=True)


def get_supabase() -> Client:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set")
    return create_client(url, key)


def main():
    supabase = get_supabase()

    # 1. Count rows needing enrichment
    count_resp = (
        supabase.table("platform_listing_images")
        .select("id", count="exact")
        .eq("source", "rakuten")
        .not_.is_("image_path", "null")
        .is_("image_url", "null")
        .execute()
    )
    total = count_resp.count
    log(f"Rows needing enrichment: {total}")
    if total == 0:
        log("Nothing to do.")
        return

    # 2. Fetch all rows needing enrichment (paginated)
    log("Fetching rows...")
    all_rows = []
    page_size = 1000
    offset = 0
    while True:
        resp = (
            supabase.table("platform_listing_images")
            .select("id,listing_id,image_position,image_path")
            .eq("source", "rakuten")
            .not_.is_("image_path", "null")
            .is_("image_url", "null")
            .range(offset, offset + page_size - 1)
            .order("id")
            .execute()
        )
        batch = resp.data or []
        if not batch:
            break
        all_rows.extend(batch)
        offset += page_size
        log(f"  Fetched {len(all_rows)}/{total}...")

    log(f"Fetched {len(all_rows)} rows total.")

    # 3. Build updates with full URLs
    updates = []
    for row in all_rows:
        updates.append({
            "id": row["id"],
            "listing_id": row["listing_id"],
            "image_position": row["image_position"],
            "image_url": f"{CDN_BASE}{row['image_path']}",
        })

    # 4. Batch upsert
    batches = [updates[i:i + BATCH_SIZE] for i in range(0, len(updates), BATCH_SIZE)]
    log(f"Upserting in {len(batches)} batches of up to {BATCH_SIZE}...")

    written = 0
    errors = 0
    for i, batch in enumerate(batches):
        try:
            resp = (
                supabase.table("platform_listing_images")
                .upsert(batch, on_conflict="listing_id,image_position")
                .execute()
            )
            if hasattr(resp, "error") and resp.error:
                log(f"  Batch {i+1}/{len(batches)} ERROR: {resp.error}")
                errors += 1
            else:
                written += len(batch)
                log(f"  Batch {i+1}/{len(batches)}: {len(batch)} rows written ({written}/{total})")
        except Exception as e:
            log(f"  Batch {i+1}/{len(batches)} EXCEPTION: {e}")
            errors += 1
        time.sleep(0.2)  # gentle rate limit

    # 5. Final verification
    log(f"\n{'='*50}")
    log(f"Complete: {written} written, {errors} errors")

    verify = (
        supabase.table("platform_listing_images")
        .select("id", count="exact")
        .eq("source", "rakuten")
        .not_.is_("image_url", "null")
        .execute()
    )
    log(f"Rows with image_url: {verify.count}/{4549}")

    still_null = (
        supabase.table("platform_listing_images")
        .select("id", count="exact")
        .eq("source", "rakuten")
        .not_.is_("image_path", "null")
        .is_("image_url", "null")
        .execute()
    )
    log(f"Rows still without image_url: {still_null.count}")


if __name__ == "__main__":
    main()
