#!/usr/bin/env bash
# Uploads the private data files (git-ignored) as compressed GitHub secrets for the Pages build.
# A secret holds at most 48 KB; gzip + base64 keeps the answer file well under that.
# Needs the GitHub CLI (gh) logged in. Run from anywhere inside the repo:
#   scripts/set-data-secrets.sh            # all three files
#   scripts/set-data-secrets.sh answers    # just one
set -euo pipefail
cd "$(git rev-parse --show-toplevel)/frontend/public/data"

LIMIT=49152
names=("${@:-answers safety blocked}")
for name in ${names[@]}; do
  file="$name.json"
  [ -f "$file" ] || { echo "skip $file (not found)"; continue; }
  node -e "JSON.parse(require('fs').readFileSync('$file','utf8'))" || { echo "$file is not valid JSON"; exit 1; }
  packed=$(gzip -9c "$file" | base64 | tr -d '\n')
  size=${#packed}
  [ "$size" -lt "$LIMIT" ] || { echo "$file is still too large after compression ($size bytes)"; exit 1; }
  secret="$(echo "$name" | tr '[:lower:]' '[:upper:]')_JSON_GZ"
  printf '%s' "$packed" | gh secret set "$secret"
  echo "$secret set ($size of $LIMIT bytes)"
done
echo "Re-run the Pages workflow (or push) to deploy with the new data."
