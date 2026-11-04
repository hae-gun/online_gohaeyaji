# 이용 통계 분석 (DuckDB)

서버에 쌓인 이벤트 파일(`docs/analytics.md`)을 맥으로 받아서 SQL로 봅니다. 서버에서 무거운 분석을 돌리지 않아도 됩니다.

## 준비 (처음 한 번)

```bash
brew install duckdb
```

## 파일 받기

서버에서 레포의 `backend` 폴더로 가서 파일을 꺼낸 뒤 맥으로 가져옵니다.

```bash
# 서버에서
cd ~/gohaeyaji/backend          # 서버의 레포 위치에 맞게
docker compose cp realtime-server:/data/track ./track-export
tar czf track-export.tgz track-export && rm -rf track-export

# 맥에서 (서버 주소는 각자의 ssh 설정 이름으로)
scp <서버>:~/gohaeyaji/backend/track-export.tgz .
tar xzf track-export.tgz && mv track-export scripts/analytics/track
```

`scripts/analytics/track/`은 `.gitignore`에 들어 있어 레포에 올라가지 않습니다.

## 실행

```bash
cd scripts/analytics
./run.sh            # 전부
./run.sh funnel     # 하나만: funnel, dwell, retention, content, sources, travel
```

| 파일 | 보는 것 |
|---|---|
| funnel.sql | 날짜별로 접속, 입장, 이동, 고해소, 고해, 답변 끝까지, 카드까지 간 접속 수와 비율 |
| dwell.sql | 머문 시간 중간값과 상위 10%(날짜, 기기별), 장소별 머문 시간 |
| retention.sql | 첫 방문일별로 다음 날, 7일 안에 다시 온 비율 |
| content.sql | 카테고리별 고해, 끝까지 들음, 카드 비율, 답변 종류, 신부님별 반응, 감정표현과 성당에서 한 일 |
| sources.sql | 유입 경로와 기기별 머문 시간, 고해소와 고해 비율, 시간대별 접속 |
| travel.sql | 이동하기를 쓴 접속과 안 쓴 접속 비교, 목적지 |

새 질문은 `_events.sql`의 두 뷰를 쓰면 됩니다. `events`(이벤트 한 줄씩: at_kst, day, vid, sid, type, p)와 `visits`(접속 하나에 한 줄: 시작, 머문 초, 유입 경로, 기기, 단계별 도달 여부). `p`는 JSON이라 `p->>'place'`처럼 꺼냅니다.
