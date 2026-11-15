#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/dist"
rm -rf "$OUT"
mkdir -p "$OUT"
cp "$ROOT/src/control-center.html" "$OUT/index.html"
if [[ -d "$ROOT/assets" ]]; then cp -R "$ROOT/assets" "$OUT/assets"; fi
cp "$ROOT/_routes.json" "$OUT/_routes.json"
printf 'Control Center output prepared at %s\n' "$OUT"
