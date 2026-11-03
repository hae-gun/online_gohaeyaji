# 고해야지 (온라인 고해성사 프로젝트) 프로젝트 메모리

이 파일은 이 레포에서 작업하는 사람과 AI가 먼저 읽는 프로젝트 맥락입니다. 결정이 바뀌면 여기와 `docs/realtime-protocol.md`를 같이 고칩니다.

## 한 줄 요약

"공부해야지, 운동해야지, 그리고 고해야지." 매일 다짐하고 자주 실패하는 일상의 작은 일을 털어놓는 3D 온라인 고해소. 진짜 목표는 **대규모 트래픽 백엔드 경험**(동시성, 실시간 브로드캐스트, 부하테스트, 수평 확장)을 직접 설계하고 측정하는 것.

- 영감: 산사(sansatemple.com, 온라인 절)가 2026년 10월 인스타그램에서 바이럴
- 레포: https://github.com/hae-gun/online_gohaeyaji
- 프론트 배포: https://gohaeyaji.com (GitHub Pages 커스텀 도메인, GitHub Actions. 예전 주소 hae-gun.github.io/online_gohaeyaji 는 새 도메인으로 넘어감)
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

## 구조

```
frontend/   Vite 5.4.21 + three.js 0.128.0 (색감 때문에 고정)
  src/main.js          상태 전이(intro, hall, opening, room, leaving), 프레임 루프
  src/world/           앞마당(분수대 광장, 벤치, 비둘기와 모이 주기), 성당 둘레길, 숲 산책로, 이벤트 광장(무대, setBanner로 수능 연말 행사 현수막), layout.js(바깥 좌표), 성당 정면(가우디풍), 본당(hall.js: 장의자, 촛불, 봉헌함, 성수대)과 고해소 방(21칸, 신께 알리기 함), 캐릭터, 고해소 내부와 성호경
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
docs/realtime-protocol.md   프론트와 서버의 메시지 규약 (v0.4), 정책 결정 기록
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

## 규약 핵심 (docs/realtime-protocol.md v0.4)

- 메시지: hello/welcome, ping/pong(10초), claim/claimResult, release/released, activity, booth(변경분, seq), snapshot, resync, error. 줄서기 메시지(queueJoin, queueCall 등)는 정의만 됨
- 채널: 고해소 21칸(v0.8, 왼쪽 앞 오른쪽 벽에 7칸씩), 정원 100명(이전 60명), 80명(80%) 차면 다음 채널 생성, 앞 채널부터 채움, 남은 20자리는 재접속용
- 타이머: 하트비트 끊김 30초, 방 임대 30초(ping마다 연장), 재접속 유예 15초, 무입력 90초(20초 남으면 노란색, 10초 남으면 빨간색 카운터, 성호경과 답변 대기 중 멈춤), 서버 안전망 100초, 줄 호출 예약 20초
- 탭마다 별도 세션(한 세션 방 1개, 줄 1자리). IP당 연결 20개. 메시지 2KB. 허용 Origin: https://gohaeyaji.com, https://www.gohaeyaji.com, https://hae-gun.github.io(이전 기간), http://localhost:5173
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

서버 미구현: 줄서기, 재접속 복구(resumeToken), 레이트리밋, 서버 여러 대(Redis Pub/Sub, 6단계), analyzer 연동.

## 성당 안 (규약 v0.8, 2026-11-01)

- 캐릭터는 성당 신도: 형제님(재킷, 흰 셔츠, 넥타이)과 자매님(원피스, 흰 레이스 미사보). 처음 입장할 때 고르고 세례명 창에서 바꿈. 얼굴 그리기 창에서 피부색(기본 6가지 또는 RGB로 직접)과 머리 모양 5가지(성별마다, 마지막은 항상 민머리)를 고름. 셋을 묶은 코드 하나로 서버에 보냄(`net/looks.js`, 규약 v0.17 `look`, 예 "f32")
- 정문 -> 입구 홀(z 10.2..-4.6 `NARTHEX_Z`, 장의자 없음, 바닥 별 무늬 위 안내 표지판: 앞 "본당", 오른쪽 "고해소", 뒷면 "나가는 문") -> 본당(`NAVE`, x -17..17, z -58.8..10.2, 높이 13m, 장의자 15줄 240석). 입구 홀 오른쪽 끝 옆문(`SIDE_DOOR`, x 17.3, z -4..-1, 뾰족 아치 문) -> 고해소 방(`CONFESSION_HALL`, x 17.6..45.1, 높이 8m). 옆문이 고해소 방 벽 한가운데라 들어서면 가운데 신께 알리기 함이 보이고 고해소는 양옆과 앞 벽으로 멀리 있음. 장소 이름과 소리는 `placeOf(x, z)`: yard, nave, booths
- 본당 꾸밈(`nave-dress.js`, 유럽 대성당 기준): 묶음 기둥과 금테 뾰족 아치 아케이드, 둥근 천장 가로 늑골, 제단 벽 가득 금빛 제단화(2단 벽감과 가운데 십자가 벽감, 캔버스로 그림), 제대 위 닫집(꼬인 기둥 네 개), 샹들리에 다섯(촛불 빛은 Points 하나), 입구 위 장미창. 움직이지 않는 것은 `mergeStatic`으로 합침
- 본당에서 E: 촛불 켜기(내 화면만, 3분), 봉헌하기(내 화면만, 결제 없음), 성수 찍기(`cross` 동작이라 모두에게 보임), 장의자에 앉기(`sit`)
- 길찾기(`navigation.js`)는 0.3m 격자 A*를 시작할 때 한 번 만들고, 경로는 직선으로 펴서 씀. 장애물은 원 `{x,z,r}`과 상자 `{box,x0,x1,z0,z1}`. 고해소 몸통도 상자 장애물
- 바깥에서 보이는 본당과 고해소 방 외벽은 한쪽 면만 그리는 평면(안에서는 안 보이고 카메라 광선도 통과). 두 방 사이에는 외벽을 두지 않음(옆문이 막히므로)
- 방문 통계(`stats/VisitStats`): hello 성공마다 누적과 그날 입장 수, 그날 방문자는 IP+날짜 해시를 HyperLogLog에(개수만 남음, 날이 바뀌면 같은 사람도 이어지지 않음), 최고 동시 접속은 10초마다 전체 채널 인원 합으로. 날짜는 한국 시간, 하루 단위 키는 400일 보관. 관리자 페이지 "방문" 칸에 누적과 최근 14일
- 신께 알리기: 고해소 방 가운데 함 -> `inquiry` -> Redis -> 관리자 페이지 "신께 알리기" 칸. 연락처와 IP는 저장 안 함(세례명만). IP당 제한은 IP 해시로 1시간만. 운영 Redis는 영속화 필요
- 답변 개선함(v0.11): 답 아래 "답이 엉뚱해요" -> 동의 창 -> `feedback` -> Redis 30일(이름, IP 없음, 연락처 가림) -> 관리자 페이지에서 분류하고 "AI에 넘길 내용 만들기". 고해는 그 외에는 저장하지 않음
- 답변 데이터 하루 한 번 반영(방식 A, GitHub Secrets): 관리자 페이지 "AI에 넘길 내용 만들기" -> AI 답을 patch.json으로 저장 -> `node scripts/apply-answer-patch.mjs patch.json --dry`로 확인 -> 같은 명령에서 `--dry`를 빼고 적용(이전 파일은 answers.vN.backup.json, version 1 증가) -> `scripts/set-data-secrets.sh answers --deploy`. Secret은 48KB 한도라 gzip+base64를 45,000자씩 `ANSWERS_JSON_GZ`, `_2` ~ `_6`으로 나눠 넣고 워크플로가 이어 붙임(지금 약 28,000자, 여유 약 10배). 반영까지 배포 몇 분 + Pages 캐시 최대 10분
- 채널(v0.10): 자동 배정은 낮은 번호부터 80%까지, 모두 차면 새 채널. 빈 채널(1채널 제외)은 5분 뒤 닫고 번호 재사용. 사람이 직접 열린 채널로 옮길 수 있음(정원 100까지). 채널은 논리적인 방이고 서버 대수와는 별개
- 얼굴 그리기에 직접 고르는 색 최대 8가지(격자 글자 5~9, a~c, 코드 뒤 `:rrggbb,...`). 안 쓴 색은 빼고 번호를 다시 매겨 한 그림은 한 코드(브라우저 joinFace와 서버 FaceRules.normalize가 같은 규칙)
- 신부님 목소리(`audio/voice.js`): 브라우저 TTS. 남성 한국어 음성(InJoon, Hyunsu, BongJin, GookMin, 사실상 Windows Edge)이 있으면 그것, 없으면 크롬의 "Google 한국의"를 우선으로 한 여성 음성을 높이를 낮춰 씀. 신부님마다 속도와 높이가 다름. 모두에게 같은 남성 목소리를 들려주려면 클라우드 TTS로 미리 만든 음성 파일이 필요

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

1. 맥에서 `./gradlew test`(테스트 20개) 후 `bootRun` + `npm run dev:server` 창 두 개로 서로 보이는지, 이름표가 뜨는지 확인
2. 줄서기, 재접속 복구, 레이트리밋
3. 호스팅 결정 후 배포, 부하테스트

## 신부님 세 분과 일상 대화 (answers.json v3, 2026-10-31)

- 신부님은 고해소에 들어갈 때 무작위로 정해짐(문 앞에서는 모름): 진(진지), 엄(꾸짖음), 유(유머) 각 33%. `answers.json` personas에 `"chance": 0.01`처럼 확률을 적은 신부님(이스터에그)은 그 확률로 나오고, 나머지 세 분이 남은 확률을 똑같이 나눔. `answer/pick-persona.js`. 답변 엔진을 서버로 옮길 때 이 추첨도 서버로 옮김 (`engine.personaForBooth`는 더 이상 안 씀)
- `answers.json`의 `personas`에 이름, 보속 도입부(`lead`), 짧은 입력 안내(`tooShort`). empathy와 closing은 `{ jin, eom, yu }`로 나뉘고, penance는 고해의 결과라서 세 분이 같음. 배열 하나만 두면 공용
- `chatter`: 고해가 아닌 말(인사, 칭찬, 재미없다, 외모, 디자인, 교회/성당, AI냐, 사용법, 웃음, 울음 등 18가지). 고해 카테고리에 하나도 안 걸릴 때만 사용. 보속 카드 없음, 기록에 안 남김(`kind: 'chat'`)
- 외모도 성격별로 다름(`figure.js`의 `LOOKS`, `makeFigure({ priest: true, look })`): 진 신부님은 동그란 안경에 단정한 회색 가르마 머리, 엄 신부님은 나이 들고 긴 얼굴에 굵은 검은 눈썹, 흰 콧수염, 각진 안경, 유 신부님은 젊고 통통한 둥근 얼굴에 곱슬머리, 발그레한 볼, 안경 없음. 수단, 로만 칼라, 보라색 영대(고해성사 때 실제로 매는 색)는 세 분 모두 같음. 고해소 장면에 세 분을 미리 만들어 두고 `confessional.setPriest(id)`로 보이는 분만 바꿈
- 엔진은 `penanceAt`, `closingAt` 오프셋을 돌려주고 main.js의 `faceFor`가 신부님별 표정 순서에 씀. 음성 톤은 `voice.setTone(id)`
- 샘플 파일(`answers.sample.json`)은 예전 배열 형식 그대로여도 동작함(세 분이 같은 문구를 쓰고 도입부만 다름)
- 이전 데이터 백업: `public/data/answers.v1.backup.json`(10개 카테고리), `answers.v2.backup.json`(22개 카테고리, 신부님 구분 전)
- 히든 신부님 **백 신부님**(`baek`): personas에 `"chance": 0.01`(1%), 확정 등장 없음(오직 1% 확률). 개발 실행(`npm run dev`, `dev:server`)에서만 20번 고해소에 항상 등장(`testPersona`, `import.meta.env.DEV`라 배포 빌드에서는 빠짐). `lines`가 있어서 카테고리와 상관없이 자기 공감, 보속, 마무리만 쓰고 `chatter`도 자기 것(없는 의도는 `default`). 성호경 뒤 `greeting`, 직접 나갈 때 `farewell`을 토스트로. 보속은 세 분이 같다는 원칙의 유일한 예외(만난 보상)
- 백 신부님 연출: 입장 시 종 세 번(`ambient.peal`, 고해소 안에서도 들림), 고해소 안 따뜻한 빛(`confessional.js`의 glow), 흰 머리와 흰 눈썹, 긴 흰 수염, 금색 테두리 보라 영대(`LOOKS.baek`), 금색 "전설의 보속" 카드(`#roomUi.legend`), 느리고 낮은 목소리
- 톤 원칙: 장엄하고 자비로운 노신부님일 뿐 하느님의 말씀을 전하거나 죄를 용서하는 말은 쓰지 않음. 장엄함으로 쇼츠와 늦잠을 다루는 게 웃음 포인트

## 동글동글 스타일 (2026-11-02)

- "각지고 안 귀엽다, 픽셀이 깨진다"는 피드백으로 90년대 각진 질감에서 둥글고 귀여운 스타일로 바꿈. 웃음 포인트는 각진 모양이 아니라 머리 큰 비율과 엉뚱한 소품(진 신부님 더듬이, 엄 신부님 김)
- `core/three-utils.js`의 `M`은 부드러운 음영(flatShading 없음). 둥근 도형은 면 수를 충분히(구 20x14 이상, 원기둥과 원뿔 16 이상, 나무는 IcosahedronGeometry detail 2)
- 캐릭터(`figure.js`): 매끈한 곡면, 엄 신부님 머리는 RoundedBoxGeometry, 얼굴은 머리 앞 곡면을 감싸는 패치(`faceCap`). 자세 기준점(pose)은 예전과 같아 성호경과 감정 표현 그대로 동작
- 얼굴(`pixel-face.js`): 신부님과 기본 캐릭터는 도형으로 그림(`drawVector`, 아기 얼굴 비율: 낮고 넓은 눈, 반짝이 점, 볼터치, 작은 미소, 백 신부님은 웃는 눈). 사람이 그린 얼굴은 격자 데이터 그대로 두고 화면에서만 점을 둥글게 이어 칠함(`smoothFace`), 얼굴 그리기 미리보기도 같은 방식
- 글꼴 Jua(제목), Gowun Dodum(본문), 모서리 더 둥글게
- 그린 얼굴 64x64 검토: 그림 하나 4,096자라 서버 메시지 한도 2KB를 넘고 휴대폰에서 그리기 어려움. 하려면 압축 형식과 규약, 서버 검사까지 같이 바꿔야 함 (미결정)

## 위기 대응과 답변 안전장치 (2026-11-03, 위험요인 점검 1번과 6번 반영)

- 점검에서 자해 표현 9개 중 1개만 잡히고, "손목을 그었어요", "신부님이 저를 성추행했어요"에 농담과 보속이 나가며, "모기를 죽였어요"에는 109 안내가 나가던 문제를 고침
- `safety.json` v2: 유형별 규칙과 안내. 위에서부터 검사해 처음 걸린 유형: selfharm(109, 1388, 112/119), sexual(112, 1366, 1388), harm(타인 위해와 범죄, 보속 없이 사과와 책임 안내), rage(죽이고 싶다), bullied(117, 1388, 112), violence(112, 1366, 117, 1388), eating(1388, 109, 숫자나 식단 언급 없음), pregnancy(1308 비밀상담, 판단하지 않음), gambling(1336), drugs(1342, 119). 상담 번호는 2026-11-03 확인, 1577-0199는 109 통합 뒤 유지 여부가 확인되지 않아 뺌
- 규칙 형식: any(하나라도), all(묶음마다 하나씩, 예: 사람 + 맞았다), re(정규식, 원문), unless(제외, 예: 마약김밥, 모기, 롤에서). 낱말은 띄어쓰기와 기호를 빼고 비교해서 "자 살"도 잡음. 낱말 하나로는 애매한 말("죽였", "때렸", "맞았", "목숨")은 all이나 unless로만 씀
- 엔진(`engine.js`): `compileSafety`가 v2 유형 규칙을 읽고 `{ kind: 'safety', type }`을 돌려줌. v1 파일과 파일이 없을 때(내장 최소 규칙)도 동작. 위기 판정은 금지어, 짧은 입력보다 먼저
- 범용 답변(generic): 내용을 모르는 고백을 평가하거나 놀리지 않게 바꿈("여럿 다녀가셨다", "양호한 편", "핑계는 문밖에" 삭제). 마무리에 "무거운 일이라면 사람에게 말하라" 추가
- 새 일상 대화: faith(신앙 질문, "용서해 주세요", "기도해 주세요"는 진짜 신부가 아니라 용서할 수 없고 성당으로 안내), faith_attack(종교 공격에 토론하지 않음), sad(우울, 지침에 혼내지 않고 109와 1388 안내). other_priest에서 "무서워" 키워드 제거(임신 불안이 신부님 바꾸기로 가던 원인)
- 검증 문장: 위기 37개, 위기가 아니어야 할 20개, 고해와 일상 대화 33개. 문구를 바꾸면 같은 문장으로 다시 돌릴 것
- 주의 단계(safety.json `caution`, 2026-11-03 오후): 위기 규칙엔 안 걸렸지만 "맞았", "무서워", "숨어" 같은 신호가 있으면 농담 카테고리를 건너뛰고 진지한 범용 답변(또는 `allowChat`의 부드러운 일상 대화). 결과에 `caution: true`, 걱정 표정, 답변 개선함 버튼 없음
- 위기 답변 음성: 어느 신부님이든 `voice.setTone('serious')`(차분하고 느린 같은 목소리)로 읽음. 답변 개선함은 위기, 주의, 감정 대화(sad, lonely, cry, help, advice)에는 안 뜸(수집 제외)
- 회귀 테스트: `cd frontend && npm test` (Node 기본 테스트, 추가 패키지 없음). `test/crisis-cases.mjs`의 직접, 간접, 변형, 일상 문장. 비공개 데이터가 있으면 그걸로, 없으면 샘플로 돌고 위기 테스트는 건너뜀. 배포 워크플로가 빌드 전에 실행해서 실패하면 배포 중단
- 감지율(2026-11-03): 오전 작업 전 기준선 61개 중 8개(13%), 일상 문장 오탐 26개 중 5개. 지금 회귀 문장은 전부 통과. **규칙을 고칠 때 보지 않은 문장으로 따로 재면 30개 중 5개(17%), 보강 뒤 다시 처음 보는 20개 중 5개(25%)**. 못 잡는 17개는 `known: true`로 남겨 테스트가 매번 목록을 보여 줌. 놓친 문장은 대부분 농담 없는 범용 답변으로 감
- 한계: 낱말 규칙이라 돌려 말하거나 오타가 심하면 놓침. 판정이 브라우저에서 돌아 규칙이 공개됨(엔진 서버 이전이 근본 해결). 문구와 안내 번호는 출시 전 사람이 한 번 더 검수
