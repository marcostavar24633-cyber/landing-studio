#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/dist"
rm -rf "$OUT"
mkdir -p "$OUT"
cp "$ROOT/index.html" "$OUT/index.html"
cp -R "$ROOT/app-chunks" "$OUT/app-chunks"
if [[ -d "$ROOT/assets" ]]; then cp -R "$ROOT/assets" "$OUT/assets"; fi
if [[ -d "$ROOT/financial-literacy" ]]; then cp -R "$ROOT/financial-literacy" "$OUT/financial-literacy"; fi
cp "$ROOT/_routes.json" "$OUT/_routes.json"
printf 'Cloudflare Pages output prepared at %s\n' "$OUT"
