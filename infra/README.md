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
