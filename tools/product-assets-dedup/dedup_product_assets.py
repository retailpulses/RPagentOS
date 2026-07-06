#!/usr/bin/env python3
"""Level 1 dedup of product_assets: one row per (product_spu_id, asset_url).

Guardrails (from GitHub issue #3):
  1. Dry-run first — report what will change, no mutations
  2. Backup snapshot before deletion
  3. Level 1 only: dedup within SPU, do NOT merge cross-SPU
  4. Survivor rules: prefer position=0, else lowest position; best metadata
  5. Junction table: product_image_links preserves variant↔image mapping
  6. Verify: counts, 20 SPU spot-check, platform_listing_images untouched

Usage:
  python3 dedup_product_assets.py --dry-run       # count-only, no changes
  python3 dedup_product_assets.py --backup-only   # create backup table only
  python3 dedup_product_assets.py --execute       # full dedup (requires --confirm)
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from collections import defaultdict
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))

from dotenv import load_dotenv

load_dotenv(PROJECT_ROOT / ".env.cloud.local")

from supabase import create_client, Client


BATCH_SIZE = 500
BACKUP_TABLE = "product_assets_backup_20260707"


def log(msg: str):
    print(msg, flush=True)


def get_supabase() -> Client:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set")
    return create_client(url, key)


# ─── Fetch ───────────────────────────────────────────────────────────────

def fetch_all_assets(supabase: Client) -> list[dict]:
    """Fetch all image rows from product_assets, paginated."""
    all_rows = []
    offset = 0
    while True:
        resp = (
            supabase.table("product_assets")
            .select("*")
            .eq("asset_type", "image")
            .range(offset, offset + 999)
            .order("id")
            .execute()
        )
        batch = resp.data or []
        if not batch:
            break
        all_rows.extend(batch)
        offset += 1000
        if offset % 10000 == 0:
            log(f"  Fetched {len(all_rows)}...")
    return all_rows


def fetch_assets_by_spu(supabase: Client) -> dict[str, list[dict]]:
    """Fetch all assets grouped by (product_spu_id, asset_url)."""
    rows = fetch_all_assets(supabase)
    by_key = defaultdict(list)
    for r in rows:
        spu_id = r.get("product_spu_id") or "__no_spu__"
        url = r.get("asset_url", "")
        key = f"{spu_id}::{url}"
        by_key[key].append(r)
    return dict(by_key)


# ─── Analysis ────────────────────────────────────────────────────────────

def analyze(groups: dict[str, list[dict]]) -> dict:
    """Analyze duplication without mutating anything."""
    total_rows = sum(len(g) for g in groups.values())
    unique_groups = len(groups)
    duplicate_groups = sum(1 for g in groups.values() if len(g) > 1)
    rows_to_delete = sum(len(g) - 1 for g in groups.values())

    # Per-SPU stats
    spu_counts = defaultdict(int)
    for key, group in groups.items():
        spu_id = key.split("::")[0]
        spu_counts[spu_id] += len(group)

    return {
        "total_rows": total_rows,
        "unique_groups": unique_groups,
        "duplicate_groups": duplicate_groups,
        "rows_to_delete": rows_to_delete,
        "rows_after": unique_groups,
        "reduction_pct": round(100 * rows_to_delete / total_rows, 1),
        "spus_with_assets": len(spu_counts),
    }


# ─── Survivor Selection ──────────────────────────────────────────────────

def pick_survivor(group: list[dict]) -> tuple[dict, list[dict]]:
    """Pick canonical row from a group of duplicates.

    Rules:
      1. Prefer position = 0 (main image), else lowest position
      2. Tiebreak: prefer non-null metadata, then longest raw_payload
      3. Final tiebreak: earliest created_at
    """
    # Sort by: is position 0, then position asc, then metadata, then created_at
    def sort_key(r: dict) -> tuple:
        pos = r.get("position") or 999
        is_main = 0 if pos == 0 else 1
        has_meta = 0 if r.get("metadata") and len(r.get("metadata", {})) > 0 else 1
        raw_len = len(str(r.get("raw_payload") or ""))
        created = r.get("created_at", "")
        return (is_main, pos, has_meta, -raw_len, created)

    sorted_group = sorted(group, key=sort_key)
    survivor = sorted_group[0]
    duplicates = sorted_group[1:]
    return survivor, duplicates


# ─── Backup ──────────────────────────────────────────────────────────────

def create_backup(supabase: Client):
    """Create backup snapshot of product_assets."""
    log(f"Creating backup table {BACKUP_TABLE}...")

    # Check if backup already exists
    try:
        existing = supabase.table(BACKUP_TABLE).select("id", count="exact").limit(0).execute()
        if existing.count > 0:
            log(f"  Backup table {BACKUP_TABLE} already has {existing.count} rows. Skipping.")
            return
    except Exception:
        pass  # table doesn't exist yet

    # Fetch all and insert into backup in batches
    rows = fetch_all_assets(supabase)
    log(f"  Copying {len(rows)} rows to {BACKUP_TABLE}...")

    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        # Remove id so new ids are generated (or keep them)
        resp = supabase.table(BACKUP_TABLE).insert(batch).execute()
        if hasattr(resp, "error") and resp.error:
            log(f"  Backup batch {i} ERROR: {resp.error}")
            raise RuntimeError(f"Backup failed: {resp.error}")
        if i % 10000 == 0:
            log(f"  Backed up {min(i + BATCH_SIZE, len(rows))}/{len(rows)}...")

    log(f"  Backup complete: {len(rows)} rows in {BACKUP_TABLE}")


# ─── Execute Dedup ───────────────────────────────────────────────────────

def execute_dedup(supabase: Client, groups: dict[str, list[dict]]):
    """Execute Level 1 dedup with junction table population."""
    total_groups = len(groups)
    duplicate_groups = {k: v for k, v in groups.items() if len(v) > 1}
    log(f"Processing {len(duplicate_groups)} duplicate groups out of {total_groups} total...")

    total_links = 0
    total_deleted = 0
    errors = 0
    processed = 0

    for key, group in duplicate_groups.items():
        survivor, duplicates = pick_survivor(group)
        spu_id = survivor.get("product_spu_id")

        # 1. Insert links for all duplicates into junction table
        links = []
        for dup in duplicates:
            rp = dup.get("raw_payload") or {}
            item_code = (rp.get("source_row_item_code") or "").strip() if isinstance(rp, dict) else ""
            if not item_code:
                # Try to find item_code from survivor's payload
                surv_rp = survivor.get("raw_payload") or {}
                item_code = (surv_rp.get("source_row_item_code") or "").strip() if isinstance(surv_rp, dict) else ""

            links.append({
                "image_id": survivor["id"],
                "product_spu_id": spu_id,
                "variant_id": dup.get("variant_id"),
                "item_code": item_code or "unknown",
                "position": dup.get("position") or 0,
            })

        if links:
            try:
                link_resp = (
                    supabase.table("product_image_links")
                    .upsert(links, on_conflict="image_id,variant_id,position")
                    .execute()
                )
                if hasattr(link_resp, "error") and link_resp.error:
                    log(f"  Link insert error for {key[:60]}: {link_resp.error}")
                    errors += 1
                    continue
                total_links += len(links)
            except Exception as e:
                log(f"  Link exception for {key[:60]}: {e}")
                errors += 1
                continue

        # 2. Delete duplicate rows
        dup_ids = [d["id"] for d in duplicates]
        try:
            del_resp = supabase.table("product_assets").delete().in_("id", dup_ids).execute()
            if hasattr(del_resp, "error") and del_resp.error:
                log(f"  Delete error for {key[:60]}: {del_resp.error}")
                errors += 1
                continue
            total_deleted += len(dup_ids)
        except Exception as e:
            log(f"  Delete exception for {key[:60]}: {e}")
            errors += 1
            continue

        # 3. Nullify variant_id on survivor (variant links now in junction table)
        # Also merge best raw_payload from duplicates
        try:
            best_rp = survivor.get("raw_payload") or {}
            for dup in duplicates:
                dup_rp = dup.get("raw_payload") or {}
                if isinstance(dup_rp, dict) and len(str(dup_rp)) > len(str(best_rp)):
                    best_rp = dup_rp

            supabase.table("product_assets").update({
                "variant_id": None,
                "raw_payload": best_rp,
            }).eq("id", survivor["id"]).execute()
        except Exception as e:
            log(f"  Update survivor error for {key[:60]}: {e}")
            # Non-fatal — dedup still valid even if survivor update fails

        processed += 1
        if processed % 500 == 0:
            log(f"  Processed {processed}/{len(duplicate_groups)} groups, "
                f"{total_links} links, {total_deleted} deleted, {errors} errors")
            time.sleep(0.1)

    log(f"\nDedup complete: {processed} groups, {total_links} links, "
        f"{total_deleted} deleted, {errors} errors")


# ─── Verify ──────────────────────────────────────────────────────────────

def verify(supabase: Client, expected: dict, dry_run: bool = False):
    """Verify dedup results."""
    log("\n=== Verification ===")

    # 1. Row counts
    after = supabase.table("product_assets").select("id", count="exact").eq("asset_type", "image").execute()
    log(f"product_assets rows: {after.count} (expected ~{expected['rows_after']})")

    # 2. Junction table
    links = supabase.table("product_image_links").select("id", count="exact").execute()
    log(f"product_image_links rows: {links.count}")

    # 3. Check no remaining within-SPU duplicates
    spu_url_pairs = set()
    total_after = 0
    offset = 0
    while True:
        resp = supabase.table("product_assets").select("product_spu_id,asset_url").eq("asset_type", "image").range(offset, offset + 999).execute()
        batch = resp.data or []
        if not batch:
            break
        for r in batch:
            pair = (r.get("product_spu_id"), r.get("asset_url"))
            if pair in spu_url_pairs:
                log(f"  WARNING: still-duplicated pair found: {pair}")
            spu_url_pairs.add(pair)
        total_after += len(batch)
        offset += 1000

    log(f"Unique (SPU, URL) pairs: {len(spu_url_pairs)} (should equal {total_after})")

    # 4. Spot-check 20 SPUs
    log("\n--- Spot-check 20 SPUs ---")
    # Get 20 random SPU IDs that have assets
    spu_ids = list(set(p[0] for p in list(spu_url_pairs)[:100] if p[0]))
    import random
    random.shuffle(spu_ids)
    check_ids = spu_ids[:20]

    for spu_id in check_ids:
        assets = (
            supabase.table("product_assets")
            .select("id,asset_url,position")
            .eq("product_spu_id", spu_id)
            .eq("asset_type", "image")
            .execute()
        )
        links_for_spu = (
            supabase.table("product_image_links")
            .select("id,item_code,position")
            .eq("product_spu_id", spu_id)
            .execute()
        )
        asset_urls = set(a["asset_url"] for a in (assets.data or []))
        link_codes = list(set(l["item_code"] for l in (links_for_spu.data or [])))
        log(f"  SPU {spu_id[:12]}...: {len(asset_urls)} images, "
            f"{len(links_for_spu.data or [])} variant links across {len(link_codes)} item_codes")

    # 5. platform_listing_images untouched
    pli_count = supabase.table("platform_listing_images").select("id", count="exact").execute()
    log(f"\nplatform_listing_images: {pli_count.count} rows (should be ~109441)")

    # 6. Summary
    log(f"\n{'DRY RUN — no changes made' if dry_run else 'DEDUP COMPLETE'}")
    log(f"  Before: {expected['total_rows']}")
    log(f"  After:  {after.count}")
    log(f"  Deleted: {expected['total_rows'] - after.count}")
    log(f"  Links: {links.count}")
    log(f"  Reduction: {round(100*(expected['total_rows'] - after.count)/expected['total_rows'], 1)}%")


# ─── Main ────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Level 1 dedup of product_assets")
    parser.add_argument("--dry-run", action="store_true", help="Analyze only, no changes")
    parser.add_argument("--backup-only", action="store_true", help="Create backup snapshot only")
    parser.add_argument("--execute", action="store_true", help="Execute dedup")
    parser.add_argument("--confirm", action="store_true", help="Required for --execute")
    parser.add_argument("--verify-only", action="store_true", help="Verify current state without changes")
    args = parser.parse_args()

    if not any([args.dry_run, args.backup_only, args.execute, args.verify_only]):
        parser.print_help()
        return

    supabase = get_supabase()

    # Ensure junction table exists (skip check for dry-run/verify)
    if args.execute:
        log("Checking product_image_links table...")
        try:
            supabase.table("product_image_links").select("id", count="exact").limit(0).execute()
            log("  Junction table exists.")
        except Exception:
            log("  ERROR: product_image_links table not found.")
            log("  Push migration first: trigger 'Deploy Supabase Migrations' workflow")
            log("  or run SQL manually from supabase/migrations/20260707000000_product_image_links.sql")
            return

    # Fetch and group
    log("Fetching all product_assets (this may take a moment)...")
    groups = fetch_assets_by_spu(supabase)
    stats = analyze(groups)
    log(f"\n=== Analysis ===")
    log(f"  Total rows:           {stats['total_rows']}")
    log(f"  Unique (SPU, URL):    {stats['unique_groups']}")
    log(f"  Duplicate groups:     {stats['duplicate_groups']}")
    log(f"  Rows to delete:       {stats['rows_to_delete']}")
    log(f"  Rows after dedup:     {stats['rows_after']}")
    log(f"  Reduction:            {stats['reduction_pct']}%")
    log(f"  SPUs with assets:     {stats['spus_with_assets']}")

    if args.dry_run:
        # Show sample duplicate groups
        log("\n--- Sample duplicate groups ---")
        dup_groups = [(k, v) for k, v in groups.items() if len(v) > 1]
        for key, group in dup_groups[:5]:
            spu, url = key.split("::", 1)
            positions = [r.get("position") for r in group]
            item_codes = set()
            for r in group:
                rp = r.get("raw_payload") or {}
                code = rp.get("source_row_item_code", "") if isinstance(rp, dict) else ""
                if code:
                    item_codes.add(code)
            survivor, _ = pick_survivor(group)
            log(f"  SPU={spu[:20]}... URL={url[:50]}...")
            log(f"    {len(group)} rows, positions={sorted(positions)}, "
                f"item_codes={list(item_codes)[:3]}...")
            log(f"    survivor=pos={survivor.get('position')} id={survivor['id'][:12]}...")

        log(f"\n  ... and {len(dup_groups) - 5} more duplicate groups")
        log(f"\nDRY RUN COMPLETE — no changes made. Use --execute --confirm to run.")
        return

    if args.backup_only:
        create_backup(supabase)
        return

    if args.verify_only:
        verify(supabase, stats, dry_run=True)
        return

    if args.execute:
        if not args.confirm:
            log("ERROR: --execute requires --confirm. Run with --dry-run first to review.")
            return

        # Phase 1: Backup
        create_backup(supabase)

        # Phase 2: Dedup
        log("\n=== Executing dedup ===")
        execute_dedup(supabase, groups)

        # Phase 3: Verify
        verify(supabase, stats)

        log("\n✅ DONE — Issue #3 Level 1 complete.")


if __name__ == "__main__":
    main()
