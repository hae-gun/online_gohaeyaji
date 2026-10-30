# realtime-server

Spring Boot 기반 실시간 서버 (작업 예정).

## 프론트엔드와의 계약

`frontend/src/net/room-client.js` 에 정의된 메시지를 WebSocket으로 구현합니다.

```
client -> server   { "type": "claim",   "boothId": 3 }
                   { "type": "release", "boothId": 3 }
server -> client   { "type": "snapshot",    "channelId": "ch-1", "occupied": [0, 3, 7] }
                   { "type": "claimResult", "boothId": 3, "ok": true }
```

## 해야 할 일

- [ ] 접속 시 빈자리가 있는 채널 배정 (채널당 고해소 20칸)
- [ ] 점유는 원자적으로 (Redis `SET NX` + TTL), 두 사람이 동시에 눌러도 한 명만 성공
- [ ] 클라이언트 하트비트로 TTL 연장, 연결이 끊기거나 TTL이 끝나면 자리 회수
- [ ] 무입력 자동 퇴장 (프론트는 90초 기준)
- [ ] 상태가 바뀌면 같은 채널 접속자에게 snapshot 브로드캐스트
- [ ] 서버 여러 대일 때 Redis Pub/Sub로 채널 상태 공유
- [ ] 입장과 채팅에 레이트리밋
- [ ] analyzer 호출: 타임아웃, 서킷 브레이커(Resilience4j), 범용 답변 대체
- [ ] 위기 키워드 1차 검사
- [ ] 답변 엔진 이전: `answers.json`, `safety.json`, `blocked.json`을 레포 밖 경로(환경변수로 지정)나 `private-data/`(git 제외)에서 읽기. 브라우저로는 완성된 답변 문장만 보냄
- [ ] 지표: 동시접속, 채널별 점유율, claim 성공 실패 수, analyzer 지연과 실패율
- [ ] 부하테스트 (k6 또는 nGrinder)와 결과 기록
