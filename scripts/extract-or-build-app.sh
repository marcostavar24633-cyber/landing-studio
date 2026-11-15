#!/usr/bin/env bash
set -euo pipefail

SOURCE="src/landing-studio-app.html"
ARCHIVE="landing-studio-app.html.gz"

mkdir -p src app-chunks

if [[ ! -f "$SOURCE" ]]; then
  test -f "$ARCHIVE"
  gzip -dc "$ARCHIVE" > "$SOURCE"
  echo "Extracted editable application source to $SOURCE"
  exit 0
fi

node scripts/build-app-chunks.cjs

# Build workflow trigger: keep this entrypoint aligned with the branch workflow.
