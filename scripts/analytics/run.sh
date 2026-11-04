#!/usr/bin/env bash
# 이용 통계 분석. 이 폴더의 track/ 안에 있는 이벤트 파일로 쿼리를 돌린다 (README.md)
#   ./run.sh            전부
#   ./run.sh funnel     하나만
set -euo pipefail
cd "$(dirname "$0")"
command -v duckdb >/dev/null || { echo "duckdb가 없습니다: brew install duckdb"; exit 1; }
ls track/*.jsonl* >/dev/null 2>&1 || { echo "track/ 에 이벤트 파일이 없습니다 (README.md의 파일 받기)"; exit 1; }
names=("$@")
[[ ${#names[@]} -eq 0 ]] && names=(funnel dwell retention content sources travel)
for n in "${names[@]}"; do
  echo "== $n"
  duckdb -box -c ".read _events.sql" -c ".read $n.sql"
done
