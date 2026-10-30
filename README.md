# 고해야지 (gohaeyaji)

> 공부해야지, 운동해야지, 그리고 고해야지.

An online confessional for the promises you broke today.

오늘도 지키지 못한 다짐을 털어놓는 온라인 고해소입니다. 성당 앞마당에서 걸어 들어와 빈 고해소 문을 열면, 신부님이 성호경을 긋고 고해를 들은 뒤 진지한 얼굴로 조금 웃긴 보속을 내려줍니다.

- 밤새 쇼츠를 봤다면: "오늘 밤은 휴대폰을 팔이 닿지 않는 곳에 두고 주무십시오."
- 배달을 또 시켰다면: "배달비가 음식값을 넘는 순간, 그것은 식사가 아니라 기부입니다."

> 이 서비스는 실제 고해성사가 아닌 패러디입니다. 웃음의 대상은 언제나 고해하는 사람의 일상이며, 천주교의 성사와 신앙을 존중합니다.

## 왜 만들었나

바이럴 서비스는 언제 트래픽이 몰릴지 모릅니다. 이 프로젝트의 목표는 재미있는 서비스를 만드는 것과 함께, 한정된 자원(고해소 20칸)에 사람이 동시에 몰리는 상황을 직접 설계하고 측정해 보는 것입니다.

- 두 사람이 같은 순간 같은 고해소 문을 열어도 한 명만 들어가야 한다
- 탭을 닫거나 잠수를 타면 자리는 다른 사람에게 돌아가야 한다
- 채널이 꽉 차도 서비스는 무너지지 않아야 한다
- 답변 분석 서버가 죽어도 신부님은 대답해야 한다

## 구조

```
gohaeyaji/
├── frontend/                 웹 클라이언트 (Vite + three.js)
│   ├── index.html
│   ├── public/data/          답변 템플릿과 안전 키워드 (샘플만 공개)
│   └── src/
│       ├── main.js           모듈 연결, 상태 전이, 프레임 루프
│       ├── world/            앞마당, 복도, 고해소, 캐릭터, 신부 애니메이션
│       ├── controls/         키보드, 카메라, 이동 가능 영역과 경로
│       ├── answer/           답변 엔진 (서버 엔진의 프로토타입)
│       ├── net/              고해소 점유 클라이언트 (지금은 로컬 시뮬레이션)
│       ├── audio/            배경음, 신부 음성
│       ├── storage/          고해 기록 (브라우저 로컬 저장)
│       └── ui/               말풍선, 토스트, 기록 패널
├── docs/
│   └── realtime-protocol.md  프론트와 실시간 서버의 WebSocket 메시지 규약
└── backend/
    ├── realtime-server/      Spring Boot, WebSocket 채널과 고해소 점유 (예정)
    └── analyzer/             Python, 형태소 분석과 카테고리 분류 (예정)
```

### 아키텍처 (목표)

```
브라우저 ── 정적 파일, 3D, 음성 ──▶ CDN
   │
   └─ WebSocket ─▶ realtime-server (Spring) ── 점유 잠금, Pub/Sub ──▶ Redis
                          │
                          └─ HTTP, 짧은 타임아웃 ─▶ analyzer (Python)
                             실패하면 범용 답변으로 대체
```

## 실행

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
npm run build      # dist/ 를 CDN에 올리면 됩니다
```

- 서버 없이 실행하면 가짜 점유는 꺼진 상태로 시작합니다. `?sim=1` 을 붙이면 다른 사람이 고해소를 쓰는 것처럼 보이는 시뮬레이션이 켜집니다
- `npm run dev:server` 는 로컬 realtime-server(`ws://localhost:8080/ws`)에 연결합니다
- 조작: WASD 이동, 드래그로 시점 회전, 휠 또는 두 손가락으로 확대, V로 1인칭, E로 문 열기, 화면을 클릭하거나 탭하면 그곳으로 걸어감
- 한글 입력 상태에서도 이동과 E 키가 동작합니다 (물리 키 위치로 판별)

## 임시 배포 (GitHub Pages)

`main`에 `frontend/` 변경이 푸시되면 GitHub Actions가 빌드해서 `https://hae-gun.github.io/online_gohaeyaji/` 에 배포합니다 (`.github/workflows/deploy-pages.yml`).

1. 저장소 Settings > Pages > Build and deployment > Source 를 **GitHub Actions** 로 설정
2. (선택) 실제 답변 문구를 쓰려면 Settings > Secrets and variables > Actions 에 아래 시크릿을 등록. 값은 각 JSON 파일 내용 전체
   - `ANSWERS_JSON` (`answers.json`), `SAFETY_JSON` (`safety.json`), `BLOCKED_JSON` (`blocked.json`)
   - gh CLI가 있다면: `gh secret set ANSWERS_JSON < frontend/public/data/answers.json`
3. 시크릿이 없으면 샘플 데이터로 배포되고, JSON이 깨져 있으면 배포하지 않고 실패합니다

GitHub Pages는 정적 호스팅이라 고해소 점유는 각자 브라우저 안의 시뮬레이션입니다. 시크릿으로 넣은 파일도 배포된 사이트에서는 주소로 열람할 수 있으니, 레포에서만 빠진다는 점은 같습니다.

## 답변 데이터

답변 문구와 금지어는 코드와 분리된 데이터 파일이고, 실제 파일은 git에 올리지 않습니다. `frontend/public/data/` 안의 JSON은 `*.sample.json`을 빼고 모두 `.gitignore` 대상이라, 새 데이터 파일을 추가해도 실수로 올라가지 않습니다.

| 실제 파일 (git 제외) | 공개 샘플 | 용도 |
|---|---|---|
| `answers.json` | `answers.sample.json` | 카테고리 키워드와 답변 문구 |
| `safety.json` | `safety.sample.json` | 위기 키워드. 걸리면 농담을 끄고 상담 창구 안내 |
| `blocked.json` | `blocked.sample.json` | 금지어(욕설, 비하). 걸리면 보속 없이 안내 문구만, 기록에도 남기지 않음 |

실제 파일이 없으면 샘플로 동작하므로, 레포를 받은 사람도 바로 실행해 볼 수 있습니다. 검사 순서는 위기 키워드, 금지어, 답변 순입니다. 욕설이 섞여 있어도 위기 신호가 있으면 안내가 먼저 나갑니다. 위기 키워드는 데이터 파일을 하나도 못 불러와도 동작하도록 엔진 안에 최소 3개가 들어 있습니다.

> 주의: 지금은 답변 엔진이 브라우저에서 돌기 때문에, 배포된 사이트에서는 `/data/answers.json` 주소로 누구나 파일을 열어볼 수 있습니다. git에서 빼는 것은 레포 공개 시의 스포일러만 막습니다. 완전히 숨기려면 답변 엔진을 realtime-server로 옮기고, 데이터 파일은 서버만 읽는 경로에 두어야 합니다 (로드맵 참고).

답변 원칙:

1. 웃음의 대상은 고해하는 사람의 일상이지, 신이나 성사가 아니다
2. 성경 구절이나 기도문을 비틀어 쓰지 않는다
3. "죄를 사하노라" 같은 사죄 선언을 흉내 내지 않고 보속만 준다
4. 사용자가 쓴 말을 그대로 따라 하지 않는다. 사전에 있는 키워드만 답변에 들어간다
5. 위기 신호가 보이면 농담을 끄고 도움받을 곳을 안내한다

## 개인정보

- 고해 내용은 서버에 저장하지 않습니다
- 고해 기록은 사용자의 브라우저(localStorage)에만 남고, 언제든 지울 수 있습니다
- 서버에는 카테고리 매칭 결과 같은 집계 지표만 남길 예정입니다

## 로드맵

- [x] 3D 데모: 앞마당, 복도, 고해소 20칸, 신부 NPC, 템플릿 답변
- [ ] realtime-server: 채널 배정, 원자적 점유, 연결 끊김 시 회수, 상태 브로드캐스트
- [ ] analyzer: 형태소 분석 기반 분류, 장애 시 범용 답변 대체
- [ ] 답변 엔진과 데이터 파일을 서버로 이전 (브라우저에서 문구와 금지어가 보이지 않게)
- [ ] 미리 생성한 음성 파일로 신부 목소리 교체
- [ ] 부하테스트와 결과 기록
- [ ] 채널 만석 대기열
- [ ] 보속 카드 이미지 공유

## 만든 사람

I build the things I keep saying I'll build. Mostly.

## 라이선스

라이선스는 공개 전에 정할 예정입니다. (MIT 검토 중)
