# EyeScore (시선 추적 기반 스마트 악보 뷰어)

EyeScore는 일반 웹캠만을 사용하여 사용자의 얼굴 및 시선을 실시간으로 추적하고, 이를 통해 악보를 자동으로 넘겨주는 웹 기반 스마트 악보 뷰어 애플리케이션입니다. 

---

## 📌 MVP 개발 현황 (Status)

현재 애플리케이션은 **프로덕션 릴리즈가 가능한 안정적인 MVP(Minimum Viable Product)** 상태입니다.

---

## 📂 프로젝트 아키텍처 및 폴더 구조 (Architecture)

프로젝트는 유지보수성과 확장성을 극대화하기 위해 클린 아키텍처의 계층형 폴더 구조를 따르고 있습니다.

```bash
c:\PBLProject\antigravity\EyeScore-app
├── public/
│   └── mediapipe/                 # MediaPipe WebAssembly 로더 및 모델 리소스
├── src/
│   ├── app/                       # 애플리케이션 진입점 및 런타임 제어
│   │   ├── router/                # 라우터 및 전역 오버레이 배치 (AppRouter)
│   │   └── runtime/               # 렌더링 없는 시각/이벤트 백그라운드 구동 루프
│   │       ├── GazeRuntime.tsx    # 웹캠 라이프사이클 및 워커 통신 조율
│   │       ├── NavigationRuntime.tsx # 시선(dwell) 기반 자동 페이지 전환 제어
│   │       ├── PdfRuntime.tsx     # PDF 렌더링 상태 갱신 루프
│   │       └── ResearchRuntime.tsx# 분석용 로깅 루프
│   ├── domain/                    # 핵심 비즈니스 로직 및 인터페이스
│   │   ├── models/                # 데이터 구조 모델 (GazePoint, FaceLandmark 등)
│   │   ├── services/              # 수치 계산 엔진 (필터, 스무딩, 안정성 판정 등)
│   │   │   ├── CoordinateTransformService.ts # 캘리브레이션 픽셀 매핑
│   │   │   ├── DwellDetectionService.ts      # 응시(Dwell) 시간 누적 엔진
│   │   │   ├── GazeFilterService.ts          # 노이즈 필터링 (EMA)
│   │   │   └── StabilityService.ts           # 시선 고정(Stability) 여부 판정
│   │   └── usecases/              # 비즈니스 시나리오 (NavigatePageUseCase)
│   ├── infrastructure/            # 외부 라이브러리 및 하드웨어 결합 어댑터
│   │   ├── mediapipe/             # MediaPipe FaceMesh 어댑터
│   │   └── storage/               # 캘리브레이션 데이터 및 세션 로거 구현체
│   ├── presentation/              # React 컴포넌트 및 사용자 인터페이스
│   │   ├── components/            # 공용 및 도메인 단위 컴포넌트 (GazeCursor 등)
│   │   ├── layouts/               # 핵심 페이지 레이아웃 (UserViewerLayout 등)
│   │   ├── state/                 # Zustand 기반 실시간 상태 관리 (gazeStore)
│   │   ├── store/                 # 설정 및 설정 유지 스토어
│   │   └── styles/                # CSS 스타일 시트
│   └── workers/                   # 백그라운드 연산 처리를 위한 Web Worker
│       ├── types/                 # 워커 간 통신용 타입 정의
│       ├── faceTracking.worker.ts # MediaPipe 얼굴 랜드마크 추출 워커
│       └── gazePipeline.worker.ts # 필터링, 보정 변환, 드웰 계산 메인 파이프라인 워커
```

---

## 🛠 핵심 기능 및 동작 메커니즘 (Key Features)

### 1. 백그라운드 멀티 워커 파이프라인
메인 UI 스레드의 60fps 렌더링 성능을 보장하기 위해 고성능 연산이 필요한 연산들을 **두 개의 독립적인 Web Worker**로 분리하여 비동기로 병렬 처리합니다.
- **FaceTracking Worker**: 웹캠 프레임을 분석하여 478개 3차원 얼굴 랜드마크 정보를 추출합니다.
- **GazePipeline Worker**: 얼굴 랜드마크로부터 홍채(Iris) 상대적 구도를 분석하고, 노이즈 필터링(EMA), 화면 픽셀 변환, Dwell 여부 판정을 실시간 수행합니다.

### 2. 드웰 감지 기반 자동 페이지 전환 (Page Turning)
- **핫존 정의**: 악보 우측 하단 25% + 맨 아래 1/6 영역을 **다음 페이지 전환 존**, 상단 15% 영역을 **이전 페이지 전환 존**으로 인식합니다.
- **Dwell 스무딩**: 단발성 노이즈로 핫존 경계를 스쳐 지나갈 때 불필요한 게이지가 차오르는 현상을 막기 위해, Dwell 전용 감쇄 필터(DWELL_SMOOTH_ALPHA)를 거친 보간 좌표를 사용합니다.
- **Awaiting Exit Gate (이중 방지)**: 페이지 전환에 성공하는 순간 `nextAwaitingExit` 플래그를 `true`로 잠급니다. 사용자의 눈동자가 실제로 핫존을 벗어났다가(`nextInside === false`) 다시 돌아오기 전까지는 추가적인 페이지 이동이 완전히 차단됩니다.
- **Cognitive Pause (인지적 휴지기)**: 전환 후 500ms 동안은 워커의 Dwell 감지 타이머가 완전히 리셋 및 비활성화됩니다.

### 3. 고정-Alpha 및 속도-적응형 하이브리드 필터
- **사전 평활화(Pre-Gain EMA)**: MediaPipe 랜드마크 미세 지터(sub-pixel noise)가 높은 감도 배율(Gain)을 타기 전에 0.18 고정 알파 필터로 노이즈를 1차 필터링합니다.
- **안정성(Stability) 전용 평활**: 커서 표시용 보간과 별개로 안정성 판정 전용의 평활 좌표를 고정 알파 필터로 추적하여, 사용자의 시선이 정지했을 때 캘리브레이션 게이지가 막힘없이 부드럽게 차오르도록 만듭니다.

### 4. 세련된 Floating Header 디자인
- **글래스모피즘(Glassmorphism)** 적용으로 악보 텍스트 가독성을 방해하지 않는 상단 플로팅 바 디자인을 채택했습니다.
- 기본 상태에서 모든 제어 버튼들은 상단바의 배경색과 완벽히 동치(transparent)로 동기화됩니다.
- 마우스나 시선이 올라갔을 때만 Hover 피드백을 제공하며, 클릭 시 크기가 $95\%$로 작아지는 미세 축소 모션 피드백이 적용되어 있습니다.

---

## 🚀 실행 및 빌드 방법 (How to Run)

### 패키지 설치
```bash
pnpm install
```

### 개발 서버 구동 (Vite)
```bash
pnpm dev
```
개발 서버는 로컬 포트에서 시작되며, 모바일 기기 테스트를 위해 호스트네임을 바인딩하여 실행할 수 있습니다.

### 정적 파일 타입 체크
```bash
pnpm typecheck
```

### 배포용 프로덕션 빌드
```bash
pnpm build
```
빌드가 완료되면 `dist/` 폴더 내에 최적화 및 경량화 완료된 정적 파일과 백그라운드 Web Worker 번들이 저장됩니다.
