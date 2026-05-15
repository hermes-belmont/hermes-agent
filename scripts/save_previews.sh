#!/usr/bin/env bash
set -euo pipefail

# Mirror Mission Control Playwright preview screenshots from the active checkout
# to David's Finder-visible checkout while honoring deletions David makes there.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_DIR="${1:-$REPO_ROOT/mission_control_web/public/preview}"
DAVID_PREVIEW_DIR="${DAVID_PREVIEW_DIR:-/Users/hermes-agent/.hermes/hermes-agent/mission_control_web/public/preview}"
MANIFEST="$DAVID_PREVIEW_DIR/.preview_manifest.txt"

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "ERROR: source preview directory does not exist: $SOURCE_DIR" >&2
  exit 1
fi

mkdir -p "$DAVID_PREVIEW_DIR"
shopt -s nullglob

manifest_tmp="$(mktemp)"
trap 'rm -f "$manifest_tmp"' EXIT

if [[ ! -f "$MANIFEST" ]]; then
  # First run: treat the current worktree preview set as already known so existing
  # files are not reported as new captures. Also hydrate David's view path if any
  # of those known files are missing there.
  (cd "$SOURCE_DIR" && find . -maxdepth 1 -type f -name '*.png' -exec basename {} \; | sort) > "$MANIFEST"
  while IFS= read -r filename; do
    [[ -z "$filename" ]] && continue
    if [[ ! -f "$DAVID_PREVIEW_DIR/$filename" ]]; then
      cp "$SOURCE_DIR/$filename" "$DAVID_PREVIEW_DIR/$filename"
    fi
  done < "$MANIFEST"
  echo "Initialized preview manifest: $MANIFEST"
fi

# Normalize manifest in case it was edited manually.
sort -u "$MANIFEST" -o "$MANIFEST"

mirrored=0
unchanged=0
deletions=0
> "$manifest_tmp"

# Evaluate all current worktree PNGs. A file listed in the manifest but missing
# from David's folder is treated as an intentional David-side deletion and is
# removed from the worktree so the deletion sticks in future commits.
for source_path in "$SOURCE_DIR"/*.png; do
  [[ -e "$source_path" ]] || continue
  filename="$(basename "$source_path")"
  if grep -Fxq "$filename" "$MANIFEST"; then
    if [[ -f "$DAVID_PREVIEW_DIR/$filename" ]]; then
      printf '%s\n' "$filename" >> "$manifest_tmp"
      unchanged=$((unchanged + 1))
    else
      rm -f "$source_path"
      deletions=$((deletions + 1))
    fi
  else
    cp "$source_path" "$DAVID_PREVIEW_DIR/$filename"
    printf '%s\n' "$filename" >> "$manifest_tmp"
    mirrored=$((mirrored + 1))
  fi
done

sort -u "$manifest_tmp" -o "$MANIFEST"

echo "Mirrored: $mirrored new, $unchanged unchanged, $deletions deletions propagated."
echo "Manifest: $MANIFEST"
echo "Source: $SOURCE_DIR"
echo "David:  $DAVID_PREVIEW_DIR"
