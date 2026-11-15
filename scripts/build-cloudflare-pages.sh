#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/dist"
rm -rf "$OUT"
mkdir -p "$OUT/lib"
cp "$ROOT/src/control-center.html" "$OUT/index.html"
cp "$ROOT/src/control-center.js" "$OUT/control-center.js"
# Общая логика статусов и единый реестр проектов нужны панели в браузере.
cp "$ROOT/lib/workflow-status.js" "$OUT/lib/workflow-status.js"
cp "$ROOT/projects.json" "$OUT/projects.json"
if [[ -d "$ROOT/assets" ]]; then cp -R "$ROOT/assets" "$OUT/assets"; fi
cp "$ROOT/_routes.json" "$OUT/_routes.json"
printf 'Control Center output prepared at %s\n' "$OUT"
