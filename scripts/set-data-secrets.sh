#!/usr/bin/env bash
# Uploads the private data files (git-ignored) as compressed GitHub secrets for the Pages build,
# and can start the deploy right away.
#
# A secret holds at most 48 KB. Each file is gzipped and base64 encoded; when that is still too
# long it is cut into parts: <NAME>_JSON_GZ, <NAME>_JSON_GZ_2, ... up to MAX_PARTS. The workflow
# glues the parts back together. Parts left over from a bigger earlier upload are deleted.
#
# Needs the GitHub CLI (gh) logged in. Run from anywhere inside the repo:
#   scripts/set-data-secrets.sh                      # all three files
#   scripts/set-data-secrets.sh answers              # just one
#   scripts/set-data-secrets.sh answers --deploy     # and run the Pages workflow
set -euo pipefail
cd "$(git rev-parse --show-toplevel)/frontend/public/data"

PART=45000        # characters per secret, under the 48 KB limit
MAX_PARTS=6       # must match the parts listed in .github/workflows/deploy-pages.yml

deploy=0
names=()
for arg in "$@"; do
  if [ "$arg" = "--deploy" ]; then deploy=1; else names+=("$arg"); fi
done
[ ${#names[@]} -gt 0 ] || names=(answers safety blocked)

existing=$(gh secret list --json name -q '.[].name')

for name in "${names[@]}"; do
  file="$name.json"
  [ -f "$file" ] || { echo "skip $file (not found)"; continue; }
  node -e "JSON.parse(require('fs').readFileSync('$file','utf8'))" || { echo "$file is not valid JSON"; exit 1; }
  packed=$(gzip -9c "$file" | base64 | tr -d '\n')
  size=${#packed}
  parts=$(( (size + PART - 1) / PART ))
  [ "$parts" -le "$MAX_PARTS" ] || { echo "$file needs $parts parts, more than $MAX_PARTS; raise MAX_PARTS here and in the workflow"; exit 1; }
  base="$(echo "$name" | tr '[:lower:]' '[:upper:]')_JSON_GZ"
  for ((i = 1; i <= parts; i++)); do
    secret=$base; [ "$i" -gt 1 ] && secret="${base}_$i"
    printf '%s' "${packed:$(( (i - 1) * PART )):$PART}" | gh secret set "$secret"
  done
  # parts from an earlier, bigger file would be glued on and break the JSON
  for ((i = parts + 1; i <= MAX_PARTS; i++)); do
    if echo "$existing" | grep -qx "${base}_$i"; then gh secret delete "${base}_$i"; fi
  done
  echo "$base set: $size characters in $parts part(s), $(( size * 100 / (PART * MAX_PARTS) ))% of the room"
done

if [ "$deploy" = 1 ]; then
  gh workflow run deploy-pages.yml
  echo "Pages workflow started. Live in a few minutes (Pages caches pages for up to about 10 minutes)."
  echo "Follow it with: gh run watch"
else
  echo "Re-run the Pages workflow (scripts/set-data-secrets.sh answers --deploy, or push) to deploy with the new data."
fi
