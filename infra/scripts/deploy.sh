#!/usr/bin/env bash
# 고해야지 수동 배포. 서버에서 실행: gohae-deploy  (또는 infra/scripts/deploy.sh)
#
# - origin/main을 받아서 backend/ 또는 infra/app/ 이 바뀌었을 때만 재빌드, 재기동
# - 프론트나 문서만 바뀌었으면 코드만 갱신하고 재기동하지 않음 (접속자 연결 유지)
# - 실패하면 이전 커밋으로 자동 롤백, 같은 커밋은 FORCE=1 없이는 다시 시도하지 않음
#
# 이 파일도 git pull로 바뀔 수 있어서 전체를 main 함수로 감싸 끝까지 메모리에 올린 뒤 실행한다.
set -euo pipefail

main() {
  local self repo_dir
  self=$(readlink -f "$0")
  repo_dir="${REPO_DIR:-$(cd "$(dirname "$self")/../.." && pwd)}"

  local branch="${BRANCH:-main}"
  local health_url="${HEALTH_URL:-http://127.0.0.1:8080/ws}"
  local state_dir="${STATE_DIR:-$HOME/gohae}"
  local log_file="$state_dir/deploy.log"
  local failed_file="$state_dir/.deploy-failed"
  local backend_dir="$repo_dir/backend"
  local app_dir="$repo_dir/infra/app"

  mkdir -p "$state_dir"
  log() { echo "[$(date '+%F %T')] $*" | tee -a "$log_file"; }

  # 동시에 두 번 실행되지 않게
  exec 9>"/tmp/gohae-deploy.lock"
  if ! flock -n 9; then
    echo "다른 배포가 진행 중"; exit 1
  fi

  cd "$repo_dir"

  # 서버에서 직접 고친 파일이 있으면 pull이 꼬이므로 중단
  if [[ -n "$(git status --porcelain)" ]]; then
    log "중단: 서버 레포에 커밋되지 않은 수정이 있음. 레포에 커밋하고 서버는 git checkout -- <파일> 로 되돌릴 것"
    git status --short | tee -a "$log_file"
    exit 1
  fi

  git fetch --quiet origin "$branch"
  local old new
  old=$(git rev-parse HEAD)
  new=$(git rev-parse "origin/$branch")

  if [[ "$old" == "$new" && "${FORCE:-0}" != "1" ]]; then
    echo "새 커밋 없음 (${old:0:7})"
    exit 0
  fi

  if [[ "${FORCE:-0}" != "1" && -f "$failed_file" && "$(cat "$failed_file")" == "$new" ]]; then
    echo "${new:0:7}은 이전에 배포 실패한 커밋이라 건너뜀. 다시 시도: FORCE=1 gohae-deploy"
    exit 0
  fi

  if [[ "${FORCE:-0}" != "1" ]] && git diff --quiet "$old" "$new" -- backend/ infra/app/; then
    git merge --ff-only --quiet "origin/$branch"
    log "백엔드 변경 없음, 코드만 갱신: ${old:0:7} -> ${new:0:7}"
    exit 0
  fi

  log "배포 시작: ${old:0:7} -> ${new:0:7} ($(git log -1 --format=%s "$new"))"
  git merge --ff-only --quiet "origin/$branch"

  deploy() {
    # 빌드를 먼저 끝내고 교체 → 빌드하는 동안 기존 서버는 계속 돈다
    (cd "$backend_dir" && docker compose build >>"$log_file" 2>&1) || return 1
    (cd "$backend_dir" && docker compose up -d --remove-orphans >>"$log_file" 2>&1) || return 1
    # Nginx 등 앞단은 .env를 만든 뒤(도메인 설정 후)부터 함께 갱신
    if [[ -f "$app_dir/.env" ]]; then
      (cd "$app_dir" && docker compose up -d --remove-orphans >>"$log_file" 2>&1) || return 1
    fi
  }

  healthy() {
    # HTTP 응답 코드가 하나라도 오면 떠 있는 것 (WebSocket 엔드포인트라 4xx가 정상)
    local code
    for _ in $(seq 1 30); do
      code=$(curl -s -o /dev/null -w '%{http_code}' "$health_url" || true)
      [[ "$code" != "000" ]] && return 0
      sleep 2
    done
    return 1
  }

  if deploy && healthy; then
    rm -f "$failed_file"
    log "배포 성공: ${new:0:7}"
    docker image prune -f >/dev/null 2>&1 || true
  else
    log "배포 실패, ${old:0:7}로 롤백. 원인은 $log_file 의 빌드 로그 확인"
    echo "$new" > "$failed_file"
    git reset --hard --quiet "$old"
    if deploy && healthy; then
      log "롤백 완료: ${old:0:7}"
    else
      log "롤백도 실패. 직접 확인: cd $backend_dir && docker compose logs --tail 100"
    fi
    exit 1
  fi
}

main "$@"
exit
