# 이용 통계

어디서 빠지고, 얼마나 머물고, 무엇에 반응하고, 다시 오는지를 보려고 모으는 익명 이용 통계입니다. 메시지 형식은 `docs/realtime-protocol.md` 20장, 코드는 `frontend/src/net/track.js`(보내기)와 `backend/realtime-server/.../track/`(받기, 저장, 관리자 페이지)에 있습니다.

## 원칙

- **모으지 않는 것:** IP, 세례명, 고해 원문, 그린 얼굴. 고해는 답변 엔진이 고른 카테고리 id만 남고, 위기 답변은 어떤 위기였는지도 남기지 않습니다
- **사람 구분:** 브라우저에서 한 번 만드는 무작위 번호(`vid`)와 접속마다 새로 만드는 번호(`sid`). 재방문을 세는 데만 쓰고 다른 정보와 잇지 않습니다
- **끄기:** 입장 화면의 "이용 통계 보내지 않기". 고르면 그 브라우저에서는 아무것도 보내지 않습니다
- **보관:** 90일 뒤 자동 삭제(파일과 Redis 숫자 모두)
- **서버가 거르는 것:** 목록에 없는 이벤트와 키, 짧은 id나 작은 숫자가 아닌 값. 고친 페이지가 글을 보내도 통계에 들어가지 않습니다
- 개인정보 처리방침에 이 내용을 적어야 합니다. 최종 문구는 출시 전에 전문가에게 확인받는 것을 권합니다

## 흐름

```
브라우저 (net/track.js)
  이벤트를 모았다가 5초마다, 또는 15개가 쌓이면
    ├─ WebSocket: { type: "track", vid, sid, events }        평소
    └─ sendBeacon: POST /api/track (같은 본문, text/plain)    화면을 닫거나 다른 앱으로 갈 때
          │
          ▼
realtime-server (TrackService)
  TrackSchema로 거른 뒤
    ├─ Redis   gy:track:day:{날짜}          이벤트별 횟수
    │          gy:track:uv:{날짜}:{단계}    퍼널 단계별 방문자 수(HyperLogLog, 번호 목록은 남지 않음)
    │          gy:track:dim:{날짜}:{이벤트} 값별 횟수(장소, 카테고리, 동작 ...)
    ├─ 파일    TRACK_DIR/{날짜}.jsonl       한 줄에 이벤트 하나. 지난 날은 .jsonl.gz
    └─ 지표    gohaeyaji_track_events_total{type}  (Prometheus, Grafana)
```

Redis는 AOF로 영속화되어(`redis-data` 볼륨) 관리자 페이지 숫자도 재시작 뒤에 남습니다. 그래도 자세한 분석과 90일 기록의 기준은 파일입니다(Redis에는 숫자만 있고 이벤트 하나하나는 없음).

## 이벤트

| 이벤트 | 언제 | 값 |
|---|---|---|
| session_start | 페이지를 열 때 | src(유입 경로), dev(mobile, pc, tablet), inapp(인앱 브라우저), first(처음 온 브라우저) |
| intro_done | 입장 버튼 | look(m, f) |
| enter_hall | 성당 마당에 들어섬 | |
| first_move | 처음 움직임 | sec(입장 후 몇 초) |
| place_enter | 장소가 바뀜 | place(yard, around, trail, event, nave, booths) |
| travel | 이동하기 | to(yard, nave, booths) |
| booth_enter | 고해소에 들어감 | booth(번호) |
| booth_full | 들어가려는데 사용 중 | |
| go_confess | 고해하기 버튼(빈 고해소로 걸어가 들어감) | |
| confess_submit | 고해를 보냄 | persona, kind(answer, chat, safety, blocked, tooShort), cat(카테고리 id), caution, len(10자 단위), sample(예시 버튼으로 보냄) |
| answer_done | 신부님 답을 끝까지 들음 | persona, cat, grade(판결 도장: g1 초범, g2 재범, g3 상습범, g4 고해소 단골, legend) |
| card_share | 보속 카드를 만듦 | persona, cat, grade |
| history_open | 나의 고해 기록을 엶 | n(기록 수) |
| history_card | 기록에서 보속 카드를 다시 엶 | persona, cat, grade |
| booth_leave | 고해소에서 나옴 | sec(머문 초), n(고해 횟수) |
| emote | 감정표현 | id |
| sit, candle, offering, font, pigeon, inquiry | 성당에서 한 일 | sit만 place |
| face_saved, face_import, look_change, rename, channel_switch | 꾸미기와 설정 | face_saved는 src(draw, import), look_change는 rgb |
| idle_kick | 자리 비움으로 나감 | place |
| session_end | 화면을 닫거나 다른 앱으로 감 | sec(접속 후 초), place(마지막 장소) |

새 이벤트를 넣을 때는 `TrackSchema.EVENTS`(서버)에 먼저 넣어야 합니다. 서버가 모르는 이벤트는 버립니다.

## 보는 곳

1. **관리자 페이지 "이용 흐름":** 오늘, 최근 7일, 30일의 퍼널(접속, 성당 입장, 첫 이동, 고해소 입장, 고해 제출, 답변 끝까지, 카드 만들기)과 많이 나온 값(유입 경로, 기기, 장소, 카테고리, 동작 ...)
2. **Grafana:** `infra/ops/grafana/gohaeyaji-usage.json`을 가져오면 이벤트 종류별 분당 횟수를 시간대별로 봅니다
3. **DuckDB 분석(자세히):** `scripts/analytics/README.md`. 체류 시간, 장소별 머문 시간, 재방문율, 유입 경로별 비교, 이동하기 효과

## 용량

이벤트 한 줄은 약 150바이트, 접속 한 번에 20~30개입니다.

| 하루 방문자 | 하루 파일 | 90일(지난 날 gzip) |
|---|---|---|
| 1천 명 | 약 4MB | 약 40MB |
| 1만 명 | 약 40MB | 약 350MB |
| 10만 명 | 약 400MB | 약 3.5GB |

디스크 여유가 2GB(`gohaeyaji.track.min-free-mb`) 밑으로 내려가면 파일 쓰기를 멈추고 Redis 숫자만 셉니다. 서비스에는 영향이 없습니다.
