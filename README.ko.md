<p align="center">
  <a href="README.md">English</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a>
</p>

<h1 align="center">castconjure</h1>

<p align="center"><b>나만의 버추얼 아이돌을 생성합니다. 립싱크가 아니라.</b></p>
<p align="center">
  얼굴을 한 번만 생성하면, 라이브 채팅으로 그녀가 춤추고, 먹고, 말하고, 장소를 바꿉니다.<br>
  댓글 후 약 6초, 팬의 언어로.
</p>

<p align="center">
  <img src="docs/hero.gif" alt="시청자가 dance!!를 치면 0.2초 만에 알아채고, 7초 뒤 자기 목소리로 춤춘다" width="720">
</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-7c5cff"></a>
  <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A520-3ecf8e">
  <img alt="model" src="https://img.shields.io/badge/video-MiniMax%20H3%20Max%20Turbo%20via%20fal-1f2230">
  <img alt="chat" src="https://img.shields.io/badge/chat-YouTube%20Live-ff0000">
</p>

---

**castconjure**는 생성된 캐릭터를 그대로 라이브 스트리머로 만드는 오픈소스(MIT, BYOK) 도구입니다. 3D 모델도, 리깅도, 모션 캡처도, 립싱크 인형도 없습니다. 모든 반응은 그 자리에서 생성되는 5초짜리 영상이고, 목소리도 그녀의 것입니다. 립싱크 아바타는 입만 움직입니다. castconjure는 동작·의상·카메라·장면까지 통째로 생성합니다.

K-pop / 애니 팬덤 시대를 위해 만들었습니다. 아이돌은 하나, 채팅은 전 세계, 사용 가능한 것은 나만의 오리지널 캐릭터뿐.

## 이런 느낌입니다

```
 0.0 s   taro_k:  dance!!                                      (YouTube Live 채팅)
 0.2 s   채팅을 힐끗 보며 "오, 댓글 왔다! 잠깐만요."          ← 미리 생성한 '알아챔' 클립, 즉시
 4–8 s   벌떡 일어나 춤춘다 — 자막: "taro_k님! dance네, 해보자!"  ← 지금 생성, 그녀의 목소리
12 s     대기 루프로 복귀
```

빈 시간도 스포일러도 없습니다. 답변은 그것을 연기하는 클립보다 먼저 나오지 않습니다. `npm start`부터 세 번째 반응까지의 실제 앱 녹화: [docs/app-demo.mp4](docs/app-demo.mp4)

<p align="center"><img src="docs/app.gif" alt="실제 앱: 터미널, 컨트롤 패널, OBS 오버레이" width="800"></p>

## 10분 만에 시작하기

```bash
git clone https://github.com/purankuton2001/castconjure && cd castconjure
npm install && cp .env.example .env
npm start
```

Node 20 이상과 **ffmpeg**가 필요합니다 (`brew install ffmpeg`). `scripts/`의 녹화·측정 도구는 Python 3 + Pillow와 Google Chrome도 사용합니다.

**http://127.0.0.1:8787/** 을 엽니다. 기본 페르소나(白詰ゆい / Yui)가 선택되어 있고, 처음에는 무료 mock 백엔드로 전체 루프를 돌려볼 수 있습니다 (mock에서는 영상 대신 텍스트 카드가 나옵니다).

1. **Persona → Face gacha** — 얼굴 4장을 뽑고 하나를 클릭, 파생된 참조(얼굴 / 전신 / 장면)를 확인
2. **Voice gacha** (FAL_KEY 필요, 후보 목소리는 H3가 생성) — `npm run voice:gacha -- --n 2`, 마음에 드는 번호를 `npm run voice:gacha -- --adopt 1`
3. **대기 풀**과 **알아챔 클립** — `npm run idle -- --n 12`, `npm run ack -- --n 6`
4. OBS → **브라우저 소스** 추가: `http://127.0.0.1:8787/overlay?audio=1`, 1920 × 1080 (목소리를 OBS에서 직접 다루려면 `?audio=1` 제거)
5. **▶ Start** 를 누르고 *Test comment*에 *dance!!* 입력. 알아채고, 춤춥니다

실제 방송은 `.env`에 키만 넣으면 됩니다 (키는 내 컴퓨터를 떠나지 않습니다):

```bash
BACKEND=fal            FAL_KEY=…              # fal.ai에 직접 과금, 반응 1개 약 $0.25
PLATFORM=youtube       YOUTUBE_API_KEY=…      # 내 Google Cloud 프로젝트, OAuth 불필요
REPLY_PROVIDER=gemini  GEMINI_API_KEY=…       # anthropic / openai 도 가능. 댓글 언어로 답함
```

방송을 시작하고 영상 ID를 패널에 붙여 넣은 뒤 Start.

## 립싱크 아바타와 무엇이 다른가

| | Live2D / 립싱크 | 스튜디오 버추얼 아이돌 (3D + 모캡) | fal.live 류 무한 스트림 | **castconjure** |
|---|---|---|---|---|
| 움직이는 것 | 입과 머리 | 전부 (스튜디오 포함) | 전부 (고정 페르소나 없음) | **전부 — 고정된 페르소나가 채팅으로 움직임** |
| 만들려면 | 그림 + 리깅 몇 주 | 몇 달 + 팀 | — | **얼굴 가챠 → 참조 3장 → 목소리 → 성격, 약 10분** |
| 일관성 | 리깅 모델 | 리깅 모델 | 없음 | **고정 seed + 같은 설명 + 대기 프레임에서 시작** |
| 목소리 | 별도 TTS | 배우 | 없음 | **영상과 함께 생성, 같은 seed → 같은 목소리** |
| 비용 | GPU / 구독 | 예산 | 24/7 생성 | **대기는 미리 생성, 반응 1개 약 $0.25** |
| 키 / 데이터 | 그들 | 그들 | 그들 | **나** |

seed 기반 일관성은 fal 백엔드에 해당하며, 로컬 ComfyUI 백엔드는 아직 seed를 전달하지 않습니다. v0.1은 여성 페르소나만 생성합니다. 다른 프리셋은 로드맵에 있습니다.

### 연속 생성(H3 Max Director)을 쓰지 않는 이유

직접 측정했습니다. `npm run probe:director`는 실제 `minimax/h3-max/director` WebRTC 세션을 대기 프레임과 seed에서 열고, 30 / 60 / 90초에 프롬프트를 바꾸며 음성 포함으로 녹화합니다. 결과(2026년 9월, 수치는 [docs/DIRECTOR-PROBE.md](docs/DIRECTOR-PROBE.md)):

| | H3 Max Director (연속) | castconjure (클립) |
|---|---|---|
| 프롬프트 변경 → 화면 | 3–19초, 8.5초 청크의 어디에 떨어지느냐에 따라 다름 | 4–8초, 알아챔 클립은 0.2초 |
| 세션 | 120초에서 강제 종료 | 무제한 |
| 2분간 일관성 | 얼굴과 목소리는 유지되지만 귀걸이·머리·가짜 채팅 UI가 스며듦 | 매번 같은 대기 프레임에서 시작 |
| 비용 | 분당 $1.2 (프로모, 정가 $4.8), 최소 60초 | 반응 1개 약 $0.25, 대기는 무료 |

Director는 "Turbo image-to-video를 이전 프레임에서 이어 붙이는" 같은 기법을 서버 쪽에서 하는 것입니다. 세션 상한이 사라지는 날 "라이브 모드" 백엔드가 됩니다. 출발점은 이 probe 스크립트입니다.

## 안에 든 것

- **2층 오버레이** — 미리 생성한 대기 루프 위에 반응 클립이 크로스페이드. OBS 브라우저 소스 하나
- **알아챔 클립** — 댓글 0.2초 뒤 "알아채고 한마디" 클립(6개 중 랜덤)이 재생되는 동안 반응을 생성
- **답변 모드** — LLM(Gemini / Claude / OpenAI, 내 키)이 댓글 언어로 한 줄 답변. 그 줄이 대사와 자막이 됨
- **액션 디렉터** — "dance!!"를 "벌떡 일어나 온몸으로 춤추고 한 바퀴 돈다"로 바꿔 영상에 실제로 나오게 함
- **페르소나 폴더** — `data/personas/<id>/`: 참조, 목소리, seed, 대기·알아챔 풀. 복사하고 공유하세요
- **오리지널 캐릭터 전용 가드** — 실존 아이돌, 그룹, 애니/게임 캐릭터, "X처럼 생기게", 안무 요청은 조용히 제외. 차단 목록(`data/ip-names.txt`, EN / KO / JA + 글로벌 팝)은 안전 필터일 뿐 누군가를 겨냥하는 목록이 아닙니다
- 승인 모드, 속도 제한, 시청자별 쿨다운, 세션 예산 상한, 댓글 → 클립 JSONL 로그
- **백엔드** — fal (기본 H3 Max Turbo image-to-video, 최대 일관성은 reference-to-video), 로컬 ComfyUI, mock
- **도구** — `record:live`, `record:app` (헤드리스 종단간 녹화, 지연 측정, A/V 동기 수치 검사), `probe`, `probe:voice`, `probe:director` (H3 Max Director 2분 세션 녹화·측정)

## 비용

2026년 9월 fal 측정:

| 경로 | 반응 1개 (5초, 480p) | 댓글 → 화면 |
|---|---|---|
| H3 Max Turbo image-to-video (기본) | **$0.25** | **4–8초** |
| H3 Max reference-to-video, 참조 3장 + 참조 음성 | $0.46 | 10–13초 |

페르소나당 1회: 대기 12개 ≈ $3, 알아챔 6개 ≈ $1.5, 참조 ≈ $0.15. 30초마다 반응 1개면 60분 ≈ $30. 세션 상한 기본 $20. fal 대시보드의 월 한도도 설정하세요.

## 안전 설계

1. **나만의 오리지널 캐릭터만.** 얼굴은 앱 안에서만 생성되며 UI에 업로드는 없습니다 (`persona:import`는 직접 그린 그림을 넣는 개발자용 경로). 모든 프롬프트에 "가상의 성인, 실존 아이돌이나 기존 캐릭터를 닮지 않음"이 붙습니다
2. **실존 아이돌과 기존 IP는 어디서든 차단** — 댓글, 답변, 페르소나 텍스트, 가챠 프롬프트. "X처럼", "X 코스프레", "X 안무"도
3. **성인만. 목소리는 생성이며 실존 인물 복제는 없음** (클론 단계는 voice:gacha가 생성한 음성만 받습니다). **실제 음악·안무 사용 없음**
4. **주인이 주도** — on/off, 세계관, 속도, 승인, 예산
5. **AI 표시** — 배지는 기본 켜짐. 방송에서도 합성 콘텐츠로 표시하세요

castconjure는 실존 아이돌을 춤추게 하는 도구도, 그 대체품도 아닙니다. *당신의* OC입니다.

아키텍처와 로드맵은 [영어 README](README.md#architecture)를 참고하세요.

## 기여

이슈와 PR을 환영합니다 — [CONTRIBUTING.md](CONTRIBUTING.md). 처음 기여하기 좋은 것: Twitch 어댑터, 새 페르소나 템플릿, 이 README 번역, 당신의 언어로 된 알아챔 대사.

## 라이선스

MIT. 생성 비용은 *당신의* fal 계정에 직접 청구되며, 이 프로젝트는 지불하거나 중계하지 않습니다. 모델: MiniMax H3 via [fal](https://fal.ai).
