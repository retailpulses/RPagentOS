#!/usr/bin/env python3
"""
Listing Audit Worker — local POC for Agent OS MVP.

Analyzes ecommerce listings via local Ollama models and produces
structured audit results for human review. No production systems touched.
"""

import argparse
import base64
import json
import os
import re
import sys
import time
from datetime import datetime

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))


def fail_fast_dependencies():
    missing = []
    try:
        import requests
    except ImportError:
        missing.append("requests")
    try:
        import jsonschema
    except ImportError:
        missing.append("jsonschema")
    if missing:
        print("Missing required dependencies: " + ", ".join(missing))
        print("Install with:")
        print("  pip install -r " + os.path.join(PROJECT_ROOT, "requirements.txt"))
        sys.exit(1)


fail_fast_dependencies()

import requests
import jsonschema


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_schema(path):
    schema = load_json(path)
    jsonschema.Draft7Validator.check_schema(schema)
    return schema


def encode_images(image_paths, base_dir=None):
    if not image_paths:
        return []
    if base_dir is None:
        base_dir = PROJECT_ROOT
    images = []
    for path in image_paths:
        full_path = (
            os.path.join(base_dir, path) if not os.path.isabs(path) else path
        )
        if not os.path.exists(full_path):
            print(f"\n    [warn] image not found: {full_path}", end="")
            continue
        try:
            with open(full_path, "rb") as f:
                img_data = f.read()
            images.append(base64.b64encode(img_data).decode("utf-8"))
        except Exception as e:
            print(f"\n    [warn] failed to encode image {full_path}: {e}", end="")
            continue
    return images


def call_ollama(model, messages, timeout=300):
    payload = {
        "model": model,
        "format": "json",
        "stream": False,
        "options": {"temperature": 0.1},
        "messages": messages,
    }
    resp = requests.post(
        "http://localhost:11434/api/chat", json=payload, timeout=timeout
    )
    resp.raise_for_status()
    data = resp.json()
    return data["message"]["content"]


def extract_json(text):
    text = text.strip()

    # Strip markdown code fences
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    text = text.strip()

    # Direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Find outermost JSON object
    brace_match = re.search(r"\{.*\}", text, re.DOTALL)
    if brace_match:
        try:
            return json.loads(brace_match.group())
        except json.JSONDecodeError:
            pass

    # Find outermost JSON array
    bracket_match = re.search(r"\[.*\]", text, re.DOTALL)
    if bracket_match:
        try:
            return json.loads(bracket_match.group())
        except json.JSONDecodeError:
            pass

    return None


def validate_against_schema(instance, schema):
    jsonschema.validate(instance, schema)
    return True


def build_system_prompt(schema):
    schema_str = json.dumps(schema, indent=2, ensure_ascii=False)
    return (
        "You are an ecommerce listing audit worker for Japanese ecommerce operations. "
        "You analyze listings for Mercari Shops, Rakuten, and Amazon JP.\n"
        "If product images are provided, analyze them for quality, composition, "
        "visibility, and relevance to the listing.\n\n"
        "RULES:\n"
        "- Return ONLY valid JSON matching the schema below precisely.\n"
        "- NO markdown. NO explanation. NO additional text before or after the JSON.\n"
        "- Do not invent missing facts. If data is missing, mention it in issues.\n"
        "- Do not recommend direct listing update. All recommendations are for human review.\n"
        "- Use Japanese for suggested_title and suggested_description when the input is Japanese.\n"
        "- Keep suggestions practical and ecommerce-oriented.\n\n"
        "SCHEMA:\n" + schema_str
    )


def build_audit_message(listing):
    return "Audit this listing:\n" + json.dumps(
        listing, indent=2, ensure_ascii=False
    )


def build_repair_message(listing, error_detail):
    return (
        "The previous output was not valid or failed schema validation.\n"
        "Error: " + error_detail + "\n\n"
        "Return ONLY valid JSON matching the schema. "
        "Audit this listing again:\n"
        + json.dumps(listing, indent=2, ensure_ascii=False)
    )


def process_listing(listing, schema, primary_model, fallback_model):
    listing_id = listing.get("listing_id", "unknown")
    result = {
        "listing_id": listing_id,
        "status": "unknown",
        "repaired": False,
        "parsed": False,
        "model_used": primary_model,
        "runtime_seconds": 0.0,
        "error": None,
        "raw_output": None,
    }
    start = time.time()

    system_prompt = build_system_prompt(schema)

    def _attempt(model, messages):
        raw = call_ollama(model, messages)
        parsed = extract_json(raw)
        return raw, parsed

    # --- Primary attempt ---
    encoded = encode_images(listing.get("image_paths", []))
    user_msg = {"role": "user", "content": build_audit_message(listing)}
    if encoded:
        user_msg["images"] = encoded
    messages = [
        {"role": "system", "content": system_prompt},
        user_msg,
    ]
    raw_output = None
    parsed = None

    try:
        raw_output, parsed = _attempt(primary_model, messages)
        result["model_used"] = primary_model
    except requests.exceptions.ConnectionError:
        result["error"] = "model_unavailable: Ollama not reachable"
        result["status"] = "failed"
        result["runtime_seconds"] = time.time() - start
        return result
    except requests.exceptions.RequestException as e:
        # Try fallback model
        try:
            raw_output, parsed = _attempt(fallback_model, messages)
            result["model_used"] = fallback_model
        except requests.exceptions.RequestException as e2:
            result["error"] = (
                f"model_unavailable: primary=({e}), fallback=({e2})"
            )
            result["status"] = "failed"
            result["runtime_seconds"] = time.time() - start
            return result

    result["raw_output"] = raw_output

    if parsed is None:
        # Attempt repair
        repair = _repair(listing, schema, system_prompt, result["model_used"],
                         "parse_failure: could not extract JSON from model output")
        if repair:
            result["status"] = "success"
            result["repaired"] = True
            result["parsed"] = True
            result["output"] = repair["output"]
            result["raw_output"] = repair["raw_output"]
            result["runtime_seconds"] = time.time() - start
            return result
        else:
            result["status"] = "failed"
            result["error"] = "parse_failure"
            result["runtime_seconds"] = time.time() - start
            return result

    result["parsed"] = True

    # --- Schema validation ---
    try:
        validate_against_schema(parsed, schema)
        result["status"] = "success"
        result["output"] = parsed
        result["runtime_seconds"] = time.time() - start
        return result
    except jsonschema.ValidationError as e:
        # Attempt repair
        repair = _repair(listing, schema, system_prompt, result["model_used"],
                         f"schema_failure: {e.message}")
        if repair:
            result["status"] = "success"
            result["repaired"] = True
            result["output"] = repair["output"]
            result["raw_output"] = repair["raw_output"]
            result["runtime_seconds"] = time.time() - start
            return result
        else:
            result["status"] = "failed"
            result["error"] = "schema_failure"
            result["validation_error"] = e.message
            result["runtime_seconds"] = time.time() - start
            return result


def _repair(listing, schema, system_prompt, model, error_detail):
    encoded = encode_images(listing.get("image_paths", []))
    user_msg = {"role": "user",
                "content": build_repair_message(listing, error_detail)}
    if encoded:
        user_msg["images"] = encoded
    messages = [
        {"role": "system", "content": system_prompt},
        user_msg,
    ]
    try:
        raw_raw = call_ollama(model, messages)
    except requests.exceptions.RequestException:
        return None

    parsed = extract_json(raw_raw)
    if parsed is None:
        return None

    try:
        validate_against_schema(parsed, schema)
        return {"output": parsed, "raw_output": raw_raw}
    except jsonschema.ValidationError:
        return None


def write_jsonl(path, records, mode="a"):
    with open(path, mode, encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def format_summary(total, successful, failed, repaired, parse_fail, schema_fail,
                   avg_time, model):
    sep = "━" * 54
    lines = [
        "",
        sep,
        "  Listing Audit Worker — POC",
        sep,
        f"  Model       : {model}",
        f"  Time        : {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        sep,
        f"  Listings    : {total}",
        f"  Successful  : {successful}",
        f"  Repaired    : {repaired}",
        f"  Failed      : {failed}",
        f"    Parse err : {parse_fail}",
        f"    Schema err: {schema_fail}",
        f"  Avg time    : {avg_time:.1f}s per listing",
        sep,
    ]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="Listing Audit Worker — local POC for Agent OS MVP"
    )
    parser.add_argument(
        "--model",
        default="qwen3.5:9b",
        help="Primary Ollama model (default: qwen3.5:9b)",
    )
    parser.add_argument(
        "--fallback",
        default="qwen3:8b",
        help="Fallback Ollama model (default: qwen3:8b)",
    )
    parser.add_argument(
        "--samples",
        default=os.path.join(PROJECT_ROOT, "samples", "listings.sample.json"),
        help="Path to sample listings JSON file",
    )
    parser.add_argument(
        "--schema",
        default=os.path.join(PROJECT_ROOT, "schema.json"),
        help="Path to schema JSON file",
    )
    parser.add_argument(
        "--output-dir",
        default=os.path.join(PROJECT_ROOT, "output"),
        help="Output directory for results",
    )
    args = parser.parse_args()

    # Load schema
    schema = load_schema(args.schema)
    print(" Schema loaded:", args.schema)

    # Load samples
    samples = load_json(args.samples)
    print(" Samples loaded:", len(samples), "listings from", args.samples)
    print()

    # Ensure output directory
    os.makedirs(args.output_dir, exist_ok=True)

    results_path = os.path.join(args.output_dir, "audit_results.jsonl")
    failed_path = os.path.join(args.output_dir, "audit_failed.jsonl")

    # Clear output files
    open(results_path, "w").close()
    open(failed_path, "w").close()

    total = len(samples)
    successful = 0
    repaired = 0
    failed = 0
    parse_fail = 0
    schema_fail = 0
    runtimes = []

    for i, listing in enumerate(samples, 1):
        lid = listing.get("listing_id", "unknown")
        print(f"  [{i}/{total}] {lid} ... ", end="", flush=True)

        result = process_listing(
            listing, schema, args.model, args.fallback
        )

        runtimes.append(result["runtime_seconds"])

        if result["status"] == "success":
            if result["repaired"]:
                repaired += 1
                print("repaired")
            else:
                successful += 1
                print("ok")
            write_jsonl(results_path, [result])
        else:
            failed += 1
            if result["error"] == "parse_failure":
                parse_fail += 1
            elif result["error"] == "schema_failure":
                schema_fail += 1
            print("FAILED (" + result["error"] + ")")
            write_jsonl(failed_path, [result])

    # Ensure successful includes repaired for the count display
    successful_total = successful + repaired
    avg_time = sum(runtimes) / len(runtimes) if runtimes else 0.0

    summary = format_summary(
        total, successful_total, failed, repaired,
        parse_fail, schema_fail, avg_time, args.model
    )
    print(summary)

    print("  Results:", results_path)
    print("  Failed :", failed_path if failed > 0 else "(none)")
    print()


if __name__ == "__main__":
    main()
