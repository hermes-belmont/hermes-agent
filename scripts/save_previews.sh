#!/usr/bin/env bash
set -euo pipefail

# Mirror Mission Control Playwright preview screenshots from the active checkout
# to David's Finder-visible checkout. Run this after every screenshot capture.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_DIR="${1:-$REPO_ROOT/mission_control_web/public/preview}"
DAVID_PREVIEW_DIR="${DAVID_PREVIEW_DIR:-/Users/hermes-agent/.hermes/hermes-agent/mission_control_web/public/preview}"

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "ERROR: source preview directory does not exist: $SOURCE_DIR" >&2
  exit 1
fi

shopt -s nullglob
source_pngs=("$SOURCE_DIR"/*.png)
if (( ${#source_pngs[@]} == 0 )); then
  echo "ERROR: no PNG previews found in source directory: $SOURCE_DIR" >&2
  exit 1
fi

mkdir -p "$DAVID_PREVIEW_DIR"
rm -f "$DAVID_PREVIEW_DIR"/*.png
cp "$SOURCE_DIR"/*.png "$DAVID_PREVIEW_DIR"/

source_count=$(find "$SOURCE_DIR" -maxdepth 1 -type f -name '*.png' | wc -l | tr -d ' ')
david_count=$(find "$DAVID_PREVIEW_DIR" -maxdepth 1 -type f -name '*.png' | wc -l | tr -d ' ')

if [[ "$source_count" != "$david_count" ]]; then
  echo "ERROR: preview PNG count mismatch: source=$source_count david=$david_count" >&2
  exit 1
fi

source_listing=$(mktemp)
david_listing=$(mktemp)
trap 'rm -f "$source_listing" "$david_listing"' EXIT

(cd "$SOURCE_DIR" && find . -maxdepth 1 -type f -name '*.png' -print | sort) > "$source_listing"
(cd "$DAVID_PREVIEW_DIR" && find . -maxdepth 1 -type f -name '*.png' -print | sort) > "$david_listing"

if ! diff -u "$source_listing" "$david_listing" >/dev/null; then
  echo "ERROR: preview PNG filename mismatch between source and David preview directories" >&2
  diff -u "$source_listing" "$david_listing" >&2 || true
  exit 1
fi

echo "Preview screenshots mirrored successfully."
echo "Source: $SOURCE_DIR ($source_count PNGs)"
echo "David:  $DAVID_PREVIEW_DIR ($david_count PNGs)"
