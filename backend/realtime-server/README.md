# realtime-server

Spring Boot 3.3 + Java 21 실시간 서버. 규약 v0.3 구현. 메시지 형식과 정책은 [`docs/realtime-protocol.md`](../../docs/realtime-protocol.md) 를 따릅니다.

## 실행

준비물: JDK 21(없으면 Gradle이 자동으로 받음), Docker

```bash
# 1) Redis 띄우기
cd backend
docker compose up -d redis

# 2) 서버 실행
cd realtime-server
./gradlew bootRun          # ws://localhost:8080/ws

# 테스트 (Docker 필요, Redis 컨테이너를 테스트마다 자동으로 띄움)
./gradlew test

# 전부 Docker로
cd .. && docker compose up --build
```

동작 확인:
- `http://localhost:8080/actuator/health` 가 `UP`
- `http://localhost:8080/actuator/prometheus` 에서 `gohaeyaji_sessions`, `gohaeyaji_claims_total` 지표

## 구조

```
src/main/java/com/gohaeyaji/realtime/
├── RealtimeApplication.java
├── config/        RealtimeProperties(정책 값), WebSocketConfig(/ws, 허용 Origin, 메시지 크기)
├── ws/            RealtimeWebSocketHandler(메시지 처리), MessageSender(전송, 브로드캐스트)
├── session/       ClientSession(연결 하나의 상태), SessionRegistry(이 서버의 연결, 채널별 목록)
├── booth/         BoothService(방 잠금, 해제, 연장, 스냅샷)
├── presence/      PresenceService(위치, 메모리 전용), PresenceBroadcaster(200ms 배칭 전송)
├── channel/       ChannelService(채널 배정, 퇴장)
├── redis/         RedisKeys(키 규칙), LuaScripts(스크립트 로딩)
├── protocol/      Messages(서버가 보내는 메시지), CloseCodes(종료 코드)
└── maintenance/   SessionSweeper(하트비트 끊김, hello 없음, 무입력 안전망)

src/main/resources/redis/   원자적으로 처리해야 하는 모든 상태 변경 (Lua)
├── assign_channel.lua      앞 채널부터, 80명(80%) 넘으면 다음 채널 생성
├── leave_channel.lua       인원 감소 (0 미만 방지)
├── claim_booth.lua         SET NX + TTL, 성공 시 채널 seq 증가
├── renew_booth.lua         내 잠금일 때만 연장
├── release_booth.lua       내 잠금일 때만 해제
└── notify_if_free.lua      만료로 사라진 잠금을 "빈 방"으로 알릴 seq 발급 (그새 누가 잡았으면 안 알림)
```

## 설계 메모

- **방 잠금은 Redis Lua 한 번으로**: 확인하고 잡는 두 단계로 나누면 그 사이에 다른 사람이 끼어들 수 있음. `SET NX`로 한 번에 처리해서 동시에 눌러도 한 명만 성공
- **잠금 값에 세션 ID**: 연장과 해제는 값이 내 세션일 때만. 늦게 도착한 옛 세션의 해제 요청이 새 주인의 잠금을 지우지 못함
- **임대(TTL)**: 서버가 죽어도 30초 뒤 잠금이 저절로 풀림. 살아 있는 동안은 ping마다 연장
- **seq**: 채널 이벤트마다 1씩 증가. 클라이언트가 빠진 이벤트를 알아채고 `resync` 요청
- **STOMP 없이 순수 WebSocket**: 메시지 종류가 적고, 부하테스트 도구로 붙이기 쉬움
- **가상 스레드** (`spring.threads.virtual.enabled`): 연결이 많아도 스레드 풀이 병목이 되지 않게
- **전송은 `ConcurrentWebSocketSessionDecorator`**: 브로드캐스트를 여러 스레드에서 보내도 안전하고, 느린 클라이언트는 버퍼 64KB, 5초를 넘으면 끊음

## 검증

- Lua 스크립트: 실제 Redis에서 200명이 같은 방을 동시에 잡는 시도를 20회 반복해 매번 1명만 성공, 1000명 동시 접속 시 한 채널 최대 48명 확인(당시 정원 60)
- `RealtimeFlowTest`: 실제 WebSocket + Redis 컨테이너로 접속, 동시 입장 경합, 해제와 끊김 시 LED 꺼짐 전파, 80% 채널 분리, 버전 불일치 종료 확인

## 진행 상황

- [x] 접속과 채널 배정 (`hello`, `welcome`, 80% 기준 새 채널)
- [x] 하트비트 (`ping`, `pong`), 끊김 시 정리
- [x] 방 점유 (`claim`, `release`), 원자적 잠금, 임대 연장
- [x] 채널 전체에 LED 변경 전파 (`booth`, `seq`), `resync`
- [x] 무입력 안전망 (90초 + 10초)
- [x] IP당 연결 20개 제한, 메시지 2KB 제한, 허용 Origin
- [x] 지표: 접속 수, 입장 성공 실패 수
- [x] 위치 동기화 (`move`, `presence`, 200ms 배칭, pid, 초당 5회 제한) (규약 v0.3)
- [ ] 줄서기 (`queueJoin`, `queueCall`, 20초 예약)
- [ ] 재접속 복구 (`resumeToken`, 15초 유예)
- [x] 관리자 페이지 `/admin`: 현황, 신고된 얼굴 그림(7일 보관), 24시간 금지, 영구 금지, 돌려주기 (Basic 로그인, `ADMIN_PASSWORD`)
- [x] 신께 알리기 문의함 (`inquiry`, 1분에 1회, IP당 1시간 10회(IP 해시로만 셈, 저장 안 함), Redis 보관, 관리자 페이지에서 처리함과 삭제) (규약 v0.8)
- [x] 고해소 21칸, 그린 얼굴에 직접 고른 색 (규약 v0.8)
- [ ] 레이트리밋
- [x] 서버 비정상 종료 시 인원 수 보정 (서버별 인원, 5초 하트비트, 15초 지나면 제외)
- [x] 답변 개선함: 동의한 고해만 `feedback`으로 받아 30일 보관, 관리자 페이지에서 분류와 AI용 내보내기 (규약 v0.11)
- [x] 빈 채널 5분 뒤 정리, 채널 직접 옮기기 (`channels`, `switchChannel`) (규약 v0.10)
- [ ] 서버 여러 대: Redis Pub/Sub로 이벤트 전파
- [ ] 답변 엔진 이전 (`confess`, `answer`), 데이터 파일은 레포 밖 경로에서 읽기
- [ ] 부하테스트 (k6 또는 nGrinder)와 결과 기록
