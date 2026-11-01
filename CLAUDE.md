# 고해야지 (온라인 고해성사 프로젝트) 프로젝트 메모리

이 파일은 이 레포에서 작업하는 사람과 AI가 먼저 읽는 프로젝트 맥락입니다. 결정이 바뀌면 여기와 `docs/realtime-protocol.md`를 같이 고칩니다.

## 한 줄 요약

"공부해야지, 운동해야지, 그리고 고해야지." 매일 다짐하고 자주 실패하는 일상의 작은 일을 털어놓는 3D 온라인 고해소. 진짜 목표는 **대규모 트래픽 백엔드 경험**(동시성, 실시간 브로드캐스트, 부하테스트, 수평 확장)을 직접 설계하고 측정하는 것.

- 영감: 산사(sansatemple.com, 온라인 절)가 2026년 10월 인스타그램에서 바이럴
- 레포: https://github.com/hae-gun/online_gohaeyaji
- 프론트 배포: https://hae-gun.github.io/online_gohaeyaji/ (GitHub Pages, GitHub Actions)
- 로컬 경로: `~/project/gohaeyaji`

## 작업 규칙

- 문서와 대화는 한국어. 코드 주석과 식별자는 영어
- **가운뎃점(·) 쓰지 않기** (문서, UI 문구, 주석 모두)
- 사용자 말에 무조건 동의하지 말고, 반대 의견은 근거와 함께 말하기
- 실제 답변 문구, 위기 키워드, 금지어는 **git에 올리지 않음** (`frontend/public/data/*.json` 중 `*.sample.json`만 커밋)
- 커밋과 푸시는 사용자가 맥에서 직접 함

## 콘셉트와 정책 (확정)

- 타겟 10~30대. 고해 카테고리: 도파민(폰, 쇼츠, 게임), 공부, 운동, 금연, 금주, 배달, 늦잠, 미루기, 충동구매, 전 애인 연락, 범용
- 신부 NPC는 진지한 말투, 내용만 현실적이라 웃긴 무표정 개그. 그래픽은 90년대 조악한 3D(도형 조합, 모델 파일 없음). 신부는 안경, 검은 수단, 보라색 영대
- 신성모독 금지 원칙: 웃음의 대상은 고해자의 일상, 성경과 기도문을 비틀지 않음, "죄를 사하노라" 흉내 없이 보속만, 사용자 문장을 그대로 따라 하지 않고 사전 키워드만 답변에 사용, 위기 신호(자해, 자살 등)는 농담을 끄고 109, 1388 안내
- 성호경: "성부와 성자와 성령의 이름으로. 아멘." 동작은 이마, 가슴, 왼쪽 어깨, 오른쪽 어깨, 합장 (신부 기준 좌우, 사용자 확인 완료). 단어는 손이 그 지점에 닿을 때 하나씩 말함(성부와=이마, 성자와=가슴, 성령의=왼쪽 어깨, 이름으로=오른쪽 어깨, 아멘=합장). 기도가 끝나는 시점도 애니메이션 시계 기준
- 신부 표정: 말하는 동안 입이 초당 약 9번 열렸다 닫힘. 기도 중 눈 감음, 듣는 중 눈썹 올림, 답변은 공감(걱정 눈썹) > 보속(엄격) > 마무리(옅은 미소, 1.5초 유지). 위기 답변은 걱정 표정만, 웃지 않음
- 입장 시 패러디 주의 문구, 고해 원문은 서버에 저장하지 않음, 기록은 브라우저 localStorage에만
- 답변은 생성형 AI 없이 키워드 사전 + 템플릿 조합(공감, 보속, 마무리). 음성은 지금 브라우저 TTS, 최종은 문장별 사전 생성 음성 파일을 CDN 서빙
- 다른 유저 표시: 색은 pid로, 이름은 무작위 세례명(직접 변경 가능)이 3m 안에 있을 때만 머리 위에. 데모용 NPC는 넣지 않음
- 이름 규칙(규약 v0.4, 14장): 2~10자 한글 영문 숫자, 사칭(신부, 주교, 운영 등) 금지, 금지어는 서버가 비공개 `blocked.json`을 읽어 검사, 변경은 10초에 1회, 브라우저 localStorage `gohaeyaji-name`에 기억
- 그린 얼굴(규약 v0.6, 15장): 상단 "얼굴 그리기"에서 32x32 칸에 점을 찍어 눈코입을 그림(가는 붓 1칸, 굵은 붓 2x2). 색은 지우개, 검정, 빨강, 흰색, 분홍뿐이고 머리 앞면 얼굴만 그릴 수 있음. 예전 16x16 그림은 2배로 늘려 자동 변환. 다른 사람에게도 보이고, 보는 사람이 전체를 끄거나 이름표(✎)를 눌러 그림별로 숨기거나 신고할 수 있음. 숨긴 그림은 내용 해시로 브라우저에 기억. 서로 다른 3세션이 같은 그림을 신고하면 24시간 금지, 그 그림을 쓰던 사람은 기본 얼굴로 돌아가고 10분 동안 못 바꿈(`FaceReports`, `report_face.lua`). 지금 얼굴과 예전 그림 최대 12개를 브라우저에 보관. 코드: `net/faces.js`, `ui/face-editor.js`, `pixel-face.js`의 `setCustom`
- 동작(규약 v0.7, 16장): 이동 안내 위 반투명 버튼 네 개 또는 숫자키 1~4로 두 손 모아 기도, 성호경, 무릎 꿇고 만세, 꾸벅꾸벅 졸기(Claude 추천, 미사 중 조는 모습). 한 번에 하나만(끝날 때까지 버튼 잠김, 서버도 같은 규칙), 움직임은 끊기지 않게 시작과 끝을 부드럽게 이어 붙이고(ease in/out) 자세 사이도 보간. 걷기 동작과 신부님 성호경도 같은 방식, 동작 중 걷기와 시점 변경 가능(팔과 머리는 동작, 다리는 걷기). 다른 사람에게는 presence.emoted로 보임. 코드: `world/emotes.js`(목표점은 `figure.js` 유저 `pose`), 서버 `presence/Emotes.java`(시간은 프론트와 같게 유지)
- 관리자 페이지 `/admin`(realtime-server 안, 별도 인스턴스 없음): 현황(접속, 채널, 고해소, 메모리)과 신고된 얼굴 그림 목록(원본과 기록 7일 보관), 24시간 금지, 영구 금지, 돌려주기. HTTP Basic 로그인(`ADMIN_USER`, `ADMIN_PASSWORD`, 비밀번호가 없으면 페이지 자체가 404), 로그인 5번 실패하면 그 IP 10분 차단, 변경 요청은 `X-Admin` 헤더 필수(CSRF 방지). 코드: `admin/`, `face/FaceReports`, `face/FaceModeration`, `static/admin/`. 배포 때 Caddy에서 `/admin`과 `/actuator`는 내 IP만 허용할 것
- 배포 계획(2026-11-01 결정): 프론트는 GitHub Pages 유지, 백엔드는 AWS. 앱 서버 1대(Caddy, Spring + 관리자 페이지, Redis, t4g.small~medium)와 모니터링 서버 1대(Prometheus, Grafana, t4g.small). 월 5~10만 원 예산

## 구조

```
frontend/   Vite 5.4.21 + three.js 0.128.0 (색감 때문에 고정)
  src/main.js          상태 전이(intro, hall, opening, room, leaving), 프레임 루프
  src/world/           앞마당, 성당 정면, 복도, 고해소 20칸, 캐릭터, 고해소 내부와 성호경
  src/controls/        keyboard(e.code 기준), camera-rig(궤도, 벽 충돌, 1인칭), navigation
  src/answer/          답변 엔진: 위기 키워드 > 금지어 > 카테고리 매칭 > 템플릿
  src/net/room-client.js     RoomClient 계약 + 로컬 시뮬레이션
  src/net/ws-room-client.js  WebSocket 구현 (규약 v0.3)
  src/net/move-sender.js     내 위치 전송 시점 (걸을 때 200ms마다, 멈추면 1번)
  src/world/others.js        다른 유저 캐릭터 (pid로 색, 보간, 고해소 안이면 숨김, 3m 안이면 이름표)
  src/net/names.js           세례명 목록(서버 saint-names.txt와 같게 유지), 이름 기본 규칙, localStorage
  public/data/         answers/safety/blocked .json(비공개) + .sample.json(공개)
backend/
  docker-compose.yml   redis + realtime-server
  realtime-server/     Spring Boot 3.3.5, Java 21, 순수 WebSocket(/ws), Redis Lua
  analyzer/            Python 형태소 분석 서비스 (미구현, README만)
docs/realtime-protocol.md   프론트와 서버의 메시지 규약 (v0.7), 정책 결정 기록
.github/workflows/deploy-pages.yml   frontend 빌드 후 Pages 배포, 시크릿으로 비공개 데이터 주입
```

## 실행

```bash
# 프론트, 서버 없이 시뮬레이션
cd frontend && npm install && npm run dev            # localhost:5173 (가짜 점유는 기본 꺼짐, ?sim=1 이면 켬)
# 프론트, 로컬 서버 연결
npm run dev:server                                   # VITE_REALTIME_URL=ws://localhost:8080/ws

# 서버
colima status                                        # 사용자는 Docker Desktop이 아니라 Colima 사용
cd backend && docker compose up -d redis
cd realtime-server && ./gradlew bootRun              # ws://localhost:8080/ws
./gradlew test                                       # Testcontainers로 Redis 띄움 (Docker 필요)
```

## 규약 핵심 (docs/realtime-protocol.md v0.7)

- 메시지: hello/welcome, ping/pong(10초), claim/claimResult, release/released, activity, booth(변경분, seq), snapshot, resync, error. 줄서기 메시지(queueJoin, queueCall 등)는 정의만 됨
- 채널: 고해소 20칸, 정원 60명, 48명(80%) 차면 다음 채널 생성, 앞 채널부터 채움, 남은 12자리는 재접속용
- 타이머: 하트비트 끊김 30초, 방 임대 30초(ping마다 연장), 재접속 유예 15초, 무입력 90초(20초 남으면 노란색, 10초 남으면 빨간색 카운터, 성호경과 답변 대기 중 멈춤), 서버 안전망 100초, 줄 호출 예약 20초
- 탭마다 별도 세션(한 세션 방 1개, 줄 1자리). IP당 연결 20개. 메시지 2KB. 허용 Origin: https://hae-gun.github.io, http://localhost:5173
- 종료 코드: 4001 버전 불일치, 4002 하트비트, 4004 IP 초과, 4005 크기, 4006 남용, 4008 만석
- 위치 동기화(v0.3): `move`(움직일 때만 초당 최대 5회, 서버는 150ms 미만 간격 버림), `presence`(서버가 200ms마다 채널 단위로 `[pid,x,z,ry]` 묶음 전송), `welcome.you.pid`, `welcome.players`, `booth.pid`. 식별은 세션 ID 대신 채널별 pid(Redis INCR), 색은 pid로 결정, 첫 move 전에는 안 보임, 위치는 서버 메모리만(서버 여러 대 확장은 6단계)
- 이름(v0.4): `hello.name`(기억한 이름), `welcome.you.name`, `welcome.names`(`[pid, 이름]`), `presence.named`(들어오거나 바꾼 사람만), `rename`/`renameResult`(INVALID, BLOCKED, RESERVED, TOO_SOON). 서버 `NameService`, 세례명 목록 `saint-names.txt`, 금지어 파일은 `gohaeyaji.blocked-words-file`(기본 `../../frontend/public/data/blocked.json`, Docker는 `BLOCKED_WORDS_FILE`로 마운트)

## 진행 상황 (2026-10-31 기준)

| 단계 | 내용 | 상태 |
|---|---|---|
| 0 | 3D 데모, GitHub Pages 배포 | 완료 |
| 1 | 메시지 규약 v0.2 | 완료 (미결정: D12 버전 확인 유지 여부, D14 로그 보관, D15 점검 공지, Q1/Q2 줄 호출 정책, C1 빈 채널 정리 시간) |
| 2 | realtime-server v0.1 | 완료. `./gradlew test` 통과, 브라우저 콘솔 두 탭으로 claim 경합, 해제 전파, 탭 닫기 반납, seq 1~4 확인 |
| 3 | 프론트 WebSocket 연결 | 완료. 실제 Spring 서버 + `npm run dev:server`로 3D 화면 연동 확인 (2026-10-31) |
| 3.5 | 다른 유저 위치 표시 | 코드 완료. 테스트 서버로 브라우저 두 개 검증(서로 보임, 고해소 입장 시 숨김, 탭 닫으면 사라짐). 서버 통합 테스트 6개 추가. **맥에서 `./gradlew test`와 실서버 확인은 아직** |
| 3.6 | 세례명 (규약 v0.4) | 코드 완료. Node 목 서버로 브라우저 두 개 검증(무작위 세례명, 사칭/금지어/자음만/10초 제한 거절, 3m 안 이름표, 새로고침 후 유지). 서버 통합 테스트 4개 추가. **맥에서 `./gradlew test` 아직** |
| 4 | 서버 배포 | 호스팅 미정 (Oracle 무료 등급 실패, 차선은 AWS 신규 크레딧). VM 한 대에 Caddy + Spring + Redis, Docker Compose |
| 5 | 부하테스트 (k6 또는 nGrinder) | |
| 6 | 서버 여러 대, Redis Pub/Sub | |
| 7 | 답변 엔진 서버 이전 | 출시 전 필수 (지금은 배포 사이트에서 /data/*.json 열람 가능) |

서버 미구현: 줄서기, 재접속 복구(resumeToken), 레이트리밋, 빈 채널 정리, analyzer 연동. (인원 수는 서버별로 세고 5초 하트비트로 실제 접속 수에 맞추며, 15초 넘게 소식 없는 서버 몫은 빠짐. 2026-11-01)

## 알아둘 함정

- **한글 입력 상태**: 키 판별은 `e.key`가 아니라 `e.code`. 아니면 W가 'ㅈ'로 들어와 이동이 안 됨
- **백그라운드 탭**: requestAnimationFrame이 멈추므로 시간 제한 로직(무입력 카운터)은 `setInterval`로
- **인트로 카메라**: 인트로에서 돌던 yaw를 시작 시 0으로 리셋하지 않으면 W가 대각선으로 감
- **Testcontainers**: Docker Engine 29는 API 1.44 미만을 거부. `ext['testcontainers.version'] = '1.21.4'`로 해결. Colima는 소켓이 `~/.colima/default/docker.sock`이라 build.gradle에서 자동 지정
- **Vite 취약점**: 5.4.21로 대부분 해결, 나머지는 6.4.4+ 메이저 업그레이드 필요. 개발 서버는 LAN에 열지 않음
- **배포 사이트는 HTTPS**라 실서버도 wss(TLS) 필수
- `answers.json` 등 비공개 데이터는 Pages 빌드에서 GitHub Secrets(ANSWERS_JSON, SAFETY_JSON, BLOCKED_JSON)로 주입
- 고해소 점유는 오직 `room-client` 계약을 통해서만 결정. 문 열림 애니메이션은 서버 승인 후에만

## 다음 할 일

1. 맥에서 `./gradlew test`(테스트 30개) 후 `bootRun` + `npm run dev:server` 창 두 개로 서로 보이는지, 이름표가 뜨는지 확인
2. 줄서기, 재접속 복구, 레이트리밋
3. 호스팅 결정 후 배포, 부하테스트

## 신부님 세 분과 일상 대화 (answers.json v3, 2026-10-31)

- 신부님은 고해소에 들어갈 때 무작위로 정해짐(문 앞에서는 모름): 진(진지), 엄(꾸짖음), 유(유머) 각 33%. `answers.json` personas에 `"chance": 0.01`처럼 확률을 적은 신부님(이스터에그)은 그 확률로 나오고, 나머지 세 분이 남은 확률을 똑같이 나눔. `answer/pick-persona.js`. 답변 엔진을 서버로 옮길 때 이 추첨도 서버로 옮김 (`engine.personaForBooth`는 더 이상 안 씀)
- `answers.json`의 `personas`에 이름, 보속 도입부(`lead`), 짧은 입력 안내(`tooShort`). empathy와 closing은 `{ jin, eom, yu }`로 나뉘고, penance는 고해의 결과라서 세 분이 같음. 배열 하나만 두면 공용
- `chatter`: 고해가 아닌 말(인사, 칭찬, 재미없다, 외모, 디자인, 교회/성당, AI냐, 사용법, 웃음, 울음, 안부, 식사(아침/점심/저녁), 누구세요, 나이, 취미, 날씨, 생일, 명절, 농담 등 52가지. 구체적인 것을 앞에 두어 동점이면 앞의 것이 이김. 예: "안녕하세요 점심 드셨어요"는 점심으로). 고해 카테고리에 하나도 안 걸릴 때만 사용. 보속 카드 없음, 기록에 안 남김(`kind: 'chat'`)
- 캐릭터는 밤티 스타일(2026-10-31): 머리가 큰 짧은 비율, 각진 낮은 폴리곤 몸, 둥근 머리에 32x32 도트 얼굴을 평평하게 붙임(`world/pixel-face.js`, 표정이 바뀔 때만 다시 그림). 진 신부님은 계란 머리에 안테나 머리카락 한 가닥과 큰 동그란 안경, 엄 신부님은 두부 머리에 송충이 일자 눈썹과 팔자 콧수염과 머리 위 김(제일 작음, 엄할 때 볼이 빨개짐), 유 신부님은 찐빵 몸에 브로콜리 곱슬머리와 진한 볼터치와 D자 입(웃을 때 ^^), 백 신부님은 흰 상투와 처진 흰 눈썹과 긴 흰 수염과 금테 영대. 유저는 pid로 표정(멍한 눈, 졸림, 깜짝, 기본)과 머리색이 정해짐. 수단, 로만 칼라, 보라색 영대는 그대로 정확하게 유지(우스운 건 체형과 얼굴뿐). 성호경 목표점은 각 몸에서 계산(`userData.pose`), 짧은 팔이 늘어나며 닿음. 고해소 창살은 얼굴을 가리지 않게 테두리만
- 엔진은 `penanceAt`, `closingAt` 오프셋을 돌려주고 main.js의 `faceFor`가 신부님별 표정 순서에 씀. 음성 톤은 `voice.setTone(id)`
- 샘플 파일(`answers.sample.json`)은 예전 배열 형식 그대로여도 동작함(세 분이 같은 문구를 쓰고 도입부만 다름)
- 이전 데이터 백업: `public/data/answers.v1.backup.json`(10개 카테고리), `answers.v2.backup.json`(22개 카테고리, 신부님 구분 전)
- 히든 신부님 **백 신부님**(`baek`): personas에 `"chance": 0.01`(1%), 확정 등장 없음(오직 1% 확률). 개발 실행(`npm run dev`, `dev:server`)에서만 20번 고해소에 항상 등장(`testPersona`, `import.meta.env.DEV`라 배포 빌드에서는 빠짐). `lines`가 있어서 카테고리와 상관없이 자기 공감, 보속, 마무리만 쓰고 `chatter`도 자기 것(없는 의도는 `default`). 성호경 뒤 `greeting`, 직접 나갈 때 `farewell`을 토스트로. 보속은 세 분이 같다는 원칙의 유일한 예외(만난 보상)
- 백 신부님 연출: 입장 시 종 세 번(`ambient.peal`, 고해소 안에서도 들림), 고해소 안 따뜻한 빛(`confessional.js`의 glow), 흰 머리와 흰 눈썹, 긴 흰 수염, 금색 테두리 보라 영대(`LOOKS.baek`), 금색 "전설의 보속" 카드(`#roomUi.legend`), 느리고 낮은 목소리
- 톤 원칙: 장엄하고 자비로운 노신부님일 뿐 하느님의 말씀을 전하거나 죄를 용서하는 말은 쓰지 않음. 장엄함으로 쇼츠와 늦잠을 다루는 게 웃음 포인트
