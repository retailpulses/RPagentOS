#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 \"<task>\" [additional opencode args...]" >&2
  exit 2
fi

task="$1"
shift

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$repo_root"

exec opencode run \
  --agent "${OPENCODE_AGENT:-build}" \
  --title "${OPENCODE_TITLE:-RPagentOS build task}" \
  "$task" \
  "$@"
