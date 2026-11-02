# frontend

웹 클라이언트입니다. Vite와 three.js(0.128.0 고정)를 씁니다. 모델 파일 없이 도형만으로 만든 90년대풍 3D라서 첫 로딩이 가볍습니다.

```bash
npm install
npm run dev
npm run build
```

## 모듈 맵

| 경로 | 하는 일 |
|---|---|
| `src/main.js` | 모듈 연결, 상태 전이(intro, hall, opening, room), 프레임 루프 |
| `src/world/layout.js` | 바깥에서 걸을 수 있는 곳(앞마당, 성당 둘레길, 산책로, 이벤트 광장)의 좌표. 그리기, 길찾기, 장소 이름이 함께 씀 |
| `src/world/exterior.js` | 하늘, 성당 정면(사그라다 파밀리아 느낌의 탑 4개와 중앙 첨탑), 정문, 분수대 광장, 벤치(앉는 자리), 성당 둘레길, 숲 산책로, 이벤트 광장(무대, 줄전구, 안내판, `eventField.setBanner(제목, 부제)`로 현수막 변경), 숲(인스턴싱), 가로등. 움직이지 않는 벤치와 가로등은 `mergeStatic`으로 합쳐 그림 |
| `src/world/pigeons.js` | 광장 비둘기. 날아와서 앉고 쪼다가 사람이 다가오면 날아감. 모이를 주면(`feed`, 광장에서 E, 8초에 1번) 모여들어 쪼아 먹고, 먹는 동안은 가까이 가도 덜 놀람. 내 화면에만 보임 |
| `src/world/hall.js` | 본당(장의자, 제대, 촛불대, 봉헌함, 성수대, 고해소 가는 곳 표지판)과 고해소 방(신께 알리기 함), 바깥에서 보이는 외벽(버팀벽과 스테인드글라스 창) |
| `src/world/booths.js` | 고해소 21칸(왼쪽, 앞, 오른쪽 벽에 7칸씩), LED, 문 |
| `src/world/figure.js` | 플레이어와 신부 캐릭터 |
| `src/world/confessional.js` | 고해소 내부 장면, 성호경, 끄덕임, 깜빡임 |
| `src/controls/keyboard.js` | 물리 키 기준 입력 (한글 입력 상태 대응) |
| `src/controls/camera-rig.js` | 3인칭 궤도 카메라, 벽 충돌, 1인칭 |
| `src/controls/navigation.js` | 걸을 수 있는 영역(layout.js와 실내), 격자 A* 경로(성당 뒤로 돌아가기, 산책로 따라 광장까지), 장애물 따라 미끄러지기, 지금 있는 장소(`placeOf`) |
| `src/answer/engine.js` | 위기 키워드, 금지어, 카테고리 매칭, 템플릿 조합 |
| `public/data/` | 답변과 금지어 데이터. `*.sample.json`만 git에 올라감 |
| `src/net/room-client.js` | 고해소 점유 계약과 로컬 시뮬레이션 |
| `src/audio/` | 합성 배경음, 신부 음성(임시로 브라우저 TTS) |
| `src/storage/history.js` | 브라우저에만 저장하는 고해 기록 |
| `src/ui/hud.js` | 말풍선, 토스트, 기록 패널 |

## 서버와 붙일 때

`src/net/room-client.js` 의 계약(`onChange`, `claim`, `release`)만 WebSocket으로 구현하면 `main.js` 는 바꿀 필요가 없도록 나눠 두었습니다. 문 열림 애니메이션은 서버가 점유를 승인한 뒤에만 재생됩니다.

## 알려진 한계

- 신부 음성은 브라우저 내장 TTS라 기기마다 목소리가 다릅니다. 미리 생성한 음성 파일로 교체 예정입니다
- three.js를 최신 버전으로 올리면 색 관리 기본값이 바뀌어 색감이 달라질 수 있어 0.128.0으로 고정했습니다
