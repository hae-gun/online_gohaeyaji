# infra

고해야지 서버 구성과 배포. Rocky Linux 서버 두 대 기준.

실제 IP, 도메인, 비밀번호는 레포에 넣지 않는다. 아래 `<APP_IP>`, `<OPS_IP>`, `<서버키>`는 각자 값으로 바꿔 읽을 것. 값이 필요한 설정은 모두 git에서 제외된 `.env`, `prometheus.yml`에 둔다.

| 서버 | IP | 역할 |
|---|---|---|
| app | `<APP_IP>` | realtime-server, Redis, Nginx, node_exporter |
| ops | `<OPS_IP>` | Prometheus, Grafana |

```
infra/
  scripts/setup-server.sh   서버 초기 설정 (스왑, 방화벽, SSH 잠금, Docker)
  scripts/deploy.sh         수동 배포 (git pull → 변경 시 재빌드, 실패 시 롤백)
  app/                      app 서버 앞단: Nginx, certbot, node_exporter
  ops/                      ops 서버: Prometheus, Grafana
```

---

## 1. 서버 초기 설정 (서버마다 한 번)

```bash
git clone https://github.com/hae-gun/online_gohaeyaji.git ~/gohae/online_gohaeyaji
sudo bash ~/gohae/online_gohaeyaji/infra/scripts/setup-server.sh
# 끝나면 로그아웃 후 재접속 (docker 그룹 적용)
```

root 로그인과 비밀번호 로그인을 끄므로, **키로 접속되는 상태에서만** 실행할 것.

## 2. 배포 (app 서버)

처음 한 번 명령을 등록한다.

```bash
sudo ln -sf ~/gohae/online_gohaeyaji/infra/scripts/deploy.sh /usr/local/bin/gohae-deploy
```

배포할 때는 맥에서:

```bash
ssh -i ~/.ssh/<서버키> rocky@<APP_IP> gohae-deploy
```

| 상황 | 동작 |
|---|---|
| 새 커밋 없음 | 아무것도 안 함 |
| `backend/`, `infra/app/` 외의 변경만 있음 | 코드만 갱신, 재기동 안 함 |
| 백엔드 변경 | 빌드 → 교체 → `/actuator/health`가 UP인지 확인 (Redis 연결까지) |
| `infra/app/nginx/` 변경 | Nginx 재시작 후 `nginx -t` 설정 검사 |
| 실패 | 이전 커밋으로 롤백, 같은 커밋은 다시 시도 안 함 |
| 강제로 다시 배포 | `FORCE=1 gohae-deploy` |
| `.env` 변경 (git 밖) | 자동 반영 안 됨. 서버에서 해당 폴더로 가서 `docker compose up -d` |

기록: 서버의 `~/gohae/deploy.log`

**주의**
- 서버에서 레포 파일을 직접 고치면 배포가 멈춘다. 수정은 항상 맥에서 커밋.
- `backend/docker-compose.yml`의 포트는 반드시 `127.0.0.1:6379:6379`, `127.0.0.1:8080:8080`처럼 묶을 것. `0.0.0.0`이면 Docker가 방화벽을 우회해서 Redis가 인터넷에 노출된다.
- 재기동하는 몇 초 동안 접속자 연결이 끊긴다. 사람 많은 시간은 피할 것.

## 2-1. 위즈파크 임시 중계 (한국시리즈 동안만)

`wiz-relay` 컨테이너가 네이버를 호출해 `state.json`을 만들고, Nginx가 `https://api.gohaeyaji.com/wiz/state.json`으로 내보낸다. Spring과 Redis는 건드리지 않는다. 페이지는 `https://gohaeyaji.com/wizpark/`.

- 확인: 서버에서 `cd infra/app && docker compose logs --tail 20 wiz-relay`
- 멈추기: `docker compose stop wiz-relay` (페이지는 시연 장면이나 재시도 표시로 돌아감)
- 수집기나 접속자 서버 코드를 바꾸면 재시작: `docker compose restart wiz-relay wiz-presence`
- 시리즈 후 삭제: `wiz-relay/`, compose의 `wiz-relay`, `wiz-presence`, `wiz-data`, nginx의 `/wiz/`, `frontend/public/wizpark/`

## 2-1-1. 앵로그 앞단 (같은 Nginx를 같이 씀)

앵로그(github.com/hae-gun/anglog)는 이 서버에서 따로 Docker Compose 스택으로 돌고, 이 Nginx는 `api.anglog.nobody-asked.dev`(앵로그 API와 실시간. 화면은 GitHub Pages)의 TLS만 맡아 `anglog-edge` 네트워크의 `anglog-web` 하나로 넘긴다 (`app/nginx/anglog.conf.template`, 원본은 anglog 저장소 `infra/front-nginx/`).

- 처음 연결 순서와 운영은 anglog 저장소 `infra/README.md`. 요점: `docker network create anglog-edge` → 앵로그 인증서 발급 → `app/.env`에 `ANGLOG_DOMAIN` → 이 변경 배포
- 앵로그 컨테이너가 내려가 있어도 이 Nginx는 뜬다 (주소를 요청 때마다 찾음). 그때 앵로그 주소만 502
- 앵로그를 다른 서버로 옮기면 `app/nginx/anglog.conf.template`, compose의 `ANGLOG_DOMAIN`, `anglog-edge`를 지운다

## 2-2. Redis 데이터 (영속화)

Redis는 AOF로 디스크에 남긴다(`backend/docker-compose.yml`, `redis-data` 볼륨). 문의함, 답변 개선함, 얼굴 신고와 금지, 방문 통계가 Redis 재시작과 서버 재부팅 뒤에도 남는다. 기계가 갑자기 멈추면 마지막 1초치만 잃는다.

| 하면 안 되는 것 | 이유 |
|---|---|
| `docker compose down -v` | `-v`가 볼륨까지 지워 위 데이터가 모두 사라짐. 내릴 때는 `-v` 없이 |
| `docker volume prune` | 쓰지 않는 볼륨으로 보이면 지워질 수 있음 |

손으로 백업하기 (지금 상태를 파일 하나로):

```bash
cd ~/gohae/online_gohaeyaji/backend
docker compose exec -T redis redis-cli BGSAVE && sleep 2
docker cp "$(docker compose ps -q redis)":/data/dump.rdb ~/redis-$(date +%F).rdb
```

**영속화를 처음 켤 때 한 번만:** 설정이 바뀌면 Redis 컨테이너가 새로 만들어지면서 그때까지의 데이터는 비워진다. 남길 것이 있으면 배포 전에 받아 두고 배포 뒤 되돌린다. AOF를 켠 Redis는 dump.rdb가 있어도 읽지 않으므로(Redis 7에서 확인), 되돌릴 때는 AOF를 끈 채 dump.rdb로 띄운 뒤 AOF를 켜서 지금 데이터로 AOF를 새로 쓰게 한다.

```bash
# 1) 배포 전: 지금 데이터를 파일로 (예전 설정은 save가 꺼져 있어도 SAVE 명령은 됨)
cd ~/gohae/online_gohaeyaji/backend
docker compose exec -T redis redis-cli SAVE
docker cp "$(docker compose ps -q redis)":/data/dump.rdb ~/redis-before-aof.rdb
# 2) 배포
gohae-deploy
# 3) 되돌리기 (Redis가 몇 초 멈춰 접속이 끊겼다 다시 붙음)
docker compose stop redis
docker compose run --rm --no-deps -v ~/redis-before-aof.rdb:/restore.rdb:ro,z --entrypoint sh redis -c '
  rm -rf /data/appendonlydir && cp /restore.rdb /data/dump.rdb && chown -R redis:redis /data &&
  redis-server --dir /data --appendonly no --save "" --daemonize yes && sleep 1 &&
  redis-cli CONFIG SET appendonly yes &&
  until redis-cli INFO persistence | grep -q "aof_rewrite_in_progress:0" &&
        redis-cli INFO persistence | grep -q "aof_rewrite_scheduled:0"; do sleep 1; done &&
  redis-cli INFO persistence | grep aof_last_bgrewrite_status && redis-cli DBSIZE && redis-cli SHUTDOWN'
docker compose start redis
docker compose exec -T redis redis-cli DBSIZE                                  # 위와 같은 수면 되돌아온 것
docker compose exec -T redis redis-cli INFO persistence | grep aof_enabled     # aof_enabled:1
```

## 3. 도메인 연결 (도메인이 생기면)

1. DNS에 `api.도메인` A 레코드 → `<APP_IP>`
2. 설정 파일

   ```bash
   cd ~/gohae/online_gohaeyaji/infra/app
   cp .env.example .env && vi .env      # DOMAIN, CERT_EMAIL, OPS_IP
   ```

3. 인증서 발급 (80번이 비어 있을 때, 즉 Nginx 띄우기 전)

   ```bash
   set -a; . ./.env; set +a
   docker compose run --rm -p 80:80 certbot certonly --standalone \
     -d "$DOMAIN" -m "$CERT_EMAIL" --agree-tos -n
   ```

4. 앞단 기동

   ```bash
   docker compose up -d
   ```

   이후로는 `gohae-deploy`가 이것까지 함께 갱신한다.

5. 인증서 자동 갱신 (`crontab -e`)

   ```
   0 3 * * * cd $HOME/gohae/online_gohaeyaji/infra/app && docker compose run --rm certbot renew --webroot -w /var/www/certbot -q && docker compose exec nginx nginx -s reload
   ```

6. node_exporter(9100)를 ops 서버에만 열기

   ```bash
   sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="<OPS_IP>" port port="9100" protocol="tcp" accept'
   sudo firewall-cmd --reload
   ```

7. 프론트의 서버 주소를 `wss://api.도메인/ws`로 바꿔 배포

**Spring에 반영할 것**
- 허용 Origin: `https://gohaeyaji.com`, `https://www.gohaeyaji.com`, 그리고 이전 기간 동안 `https://hae-gun.github.io` (경로 없이). `backend/docker-compose.yml`의 `ALLOWED_ORIGINS`
- 클라이언트 IP: `X-Real-IP` 헤더로 읽기. 안 그러면 모든 유저가 Nginx IP 하나로 보여서 IP당 20개 제한에 전부 걸린다
- 지표: `micrometer-registry-prometheus` 의존성 + `management.endpoints.web.exposure.include=health,prometheus`. 관리 포트를 따로 두면 `app/nginx/default.conf.template`의 `/actuator/prometheus` 프록시 대상도 바꿀 것

## 3-1. 프론트 도메인 (gohaeyaji.com → GitHub Pages)

프론트는 GitHub Pages 그대로 두고 도메인만 붙인다. 순서가 중요하다: **서버의 허용 Origin에 새 도메인이 먼저 들어가 있어야** 새 주소로 연 화면이 서버에 붙는다.

1. 백엔드에 새 Origin 반영 (`backend/docker-compose.yml`의 `ALLOWED_ORIGINS`) 후 `gohae-deploy`
2. Cloudflare DNS (프록시는 끄고 **DNS only**, 회색 구름. 켜 두면 GitHub이 인증서를 못 받는다)

   | 종류 | 이름 | 값 |
   |---|---|---|
   | A | `@` | `185.199.108.153` |
   | A | `@` | `185.199.109.153` |
   | A | `@` | `185.199.110.153` |
   | A | `@` | `185.199.111.153` |
   | CNAME | `www` | `hae-gun.github.io` |

   `api` A 레코드(app 서버)는 그대로 둔다.
3. GitHub 저장소 Settings > Pages > Custom domain 에 `gohaeyaji.com` 저장. DNS 확인이 끝나면(몇 분에서 길면 한 시간) **Enforce HTTPS** 체크
4. (권장) 계정 Settings > Pages 에서 `gohaeyaji.com` 도메인 소유 확인(TXT 레코드). 남이 같은 도메인을 자기 Pages에 붙이는 것을 막는다
5. 프론트 push (보속 카드 주소 `VITE_SITE_URL=gohaeyaji.com`)
6. 확인: `https://gohaeyaji.com` 접속, `https://hae-gun.github.io/online_gohaeyaji/`가 새 주소로 넘어가는지, 개발자 도구에서 `wss://api.gohaeyaji.com/ws`가 101인지
7. 넘어가는 것을 확인하고 며칠 지나면 `ALLOWED_ORIGINS`에서 `https://hae-gun.github.io`를 뺀다

## 4. 모니터링 (ops 서버)

```bash
cd ~/gohae/online_gohaeyaji/infra/ops
cp .env.example .env && vi .env                  # GRAFANA_PASSWORD
cp prometheus.yml.example prometheus.yml && vi prometheus.yml   # APP_IP, DOMAIN
docker compose up -d
```

`prometheus.yml`의 `DOMAIN`은 도메인이 생기면 ops 서버에서 직접 고치고 `docker compose restart prometheus`. 그 전에는 `realtime` 항목이 DOWN으로 보이는 게 정상.

Grafana 접속 (맥에서):

```bash
ssh -i ~/.ssh/<서버키> -L 3000:localhost:3000 rocky@<OPS_IP>
# 브라우저: http://localhost:3000  (admin / GRAFANA_PASSWORD)
```

데이터 소스에 `http://prometheus:9090`을 추가하고, 대시보드는 Import에서 ID로 가져오면 된다.
- 1860: Node Exporter Full (CPU, 메모리, **월 송신량** 확인)
- 4701: JVM (Micrometer)

## 5. 확인 습관

```bash
ss -tlnp                 # 외부에 열린 포트: 22, 80, 443 (+ ops에만 9100)
docker ps                # PORTS에 0.0.0.0:6379 같은 게 있으면 즉시 수정
tail ~/gohae/deploy.log
```

맥에서 `nc -vz <APP_IP> 6379` 가 succeeded 면 Redis가 노출된 것.
