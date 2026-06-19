// src/workers/gazePipeline.worker.ts
console.log(
  '[Worker] file loaded',
)

import { CoordinateTransformService } from '../domain/services/CoordinateTransformService'
import { GazeFilterService } from '../domain/services/GazeFilterService'
import { StabilityService } from '../domain/services/StabilityService'
import { DwellDetectionService } from '../domain/services/DwellDetectionService'
import { HeadPoseEstimator } from '../domain/services/HeadPoseEstimator'

import type {
  LandmarkPoint,
} from '../domain/models/FaceLandmark'

import type {
  GazeWorkerInput,
  GazeWorkerOutput,
} from './types/worker.types'

console.log(
  '[Worker] before services',
)
/*
 * Worker 내부 singleton services
 *
 * frame 간 상태 유지 목적:
 * - EMA
 * - Kalman
 * - Stability history
 * - Dwell timer
 */
const coordinateService =
  new CoordinateTransformService()

const filterService =
  new GazeFilterService({
    // EMA alpha: 낮을수록 부드러움. 튀는 움직임 제어 및 스무딩 향상을 위해 0.18로 하향 조정
    smoothingFactor: 0.18,
    // 이동 평균 윈도우: 6프레임으로 확대하여 프레임 간 노이즈와 떨림 방지
    windowSize: 6,
    // 급격한 노이즈로 튀는 판정을 방지하기 위해 임계값 300으로 하향 조정
    maxJumpDistance: 300,
  })

const stabilityService =
  new StabilityService({
    maxSamples: 20,

    movementThreshold: 14,

    varianceThreshold: 120,
  })

// 기본 드웰 시간(ms) — next/prev 동일하게 800ms.
// 설정 페이지(SettingsLayout)의 "넘김 딜레이" 슬라이더가
// SET_DWELL_THRESHOLD 메시지로 이 값을 실시간 갱신한다.
let dwellThresholdMs = 800

const nextDwellService =
  new DwellDetectionService({
    defaultPolicy: {
      dwellThreshold: dwellThresholdMs,

      gracePeriod: 200,
    },
  })

const prevDwellService =
  new DwellDetectionService({
    defaultPolicy: {
      dwellThreshold: dwellThresholdMs,

      gracePeriod: 200,
    },
  })

const headPoseEstimator =
  new HeadPoseEstimator()

/**
 * 자동 중심 보정 기준점 추적기.
 *
 * 카메라 내 얼굴 위치 편향(예: 얼굴이 카메라 중앙에서 약간 오른쪽)을
 * 초기 2초 동안 학습한 뒤 기준점을 고정합니다.
 *
 * 설계 원칙:
 * - EMA 대신 정확한 누적 평균 사용 → 학습 중에도 시선 이동 댐핑 없음
 * - LOCK_AFTER_FRAMES 이후 완전 고정 (드리프트 없음)
 * - 캘리브레이션 유무 무관하게 항상 적용
 *   → 캘리브레이션 데이터는 이 보정 위에 화면 공간 오차를 추가 보정
 */
class IrisBaselineTracker {
  private baselineX = 0.5
  private baselineY = 0.5
  private sampleCount = 0
  private locked = false
  private readonly LOCK_AFTER_FRAMES = 30  // 약 1초(30fps): 초기 자세에서 빠르게 수렴 후 고정

  /**
   * 새 샘플로 기준점을 누적 평균 갱신한다. LOCK_AFTER_FRAMES에 도달하면 고정(locked)된다.
   * 이미 locked 상태면 아무 동작도 하지 않는다.
   * @param x 현재 프레임의 정규화 x 좌표
   * @param y 현재 프레임의 정규화 y 좌표
   */
  update(x: number, y: number): void {
    if (this.locked) return
    this.sampleCount++
    // 정확한 누적 평균 (EMA 아님 — 학습 중 움직임 댐핑 없음)
    this.baselineX += (x - this.baselineX) / this.sampleCount
    this.baselineY += (y - this.baselineY) / this.sampleCount
    if (this.sampleCount >= this.LOCK_AFTER_FRAMES) {
      this.locked = true
      console.log(`[IrisBaseline] 🔒 기준점 고정: x=${this.baselineX.toFixed(3)}, y=${this.baselineY.toFixed(3)}`)
    }
  }

  /** 기준점 기준으로 0.5 중심화된 좌표 반환 */
  getCentered(x: number, y: number): { x: number; y: number } {
    return {
      x: Math.min(Math.max(x - this.baselineX + 0.5, 0), 1),
      y: Math.min(Math.max(y - this.baselineY + 0.5, 0), 1),
    }
  }

  /** @returns 현재 기준점의 x 좌표 */
  getBaselineX(): number {
    return this.baselineX
  }

  /** @returns 현재 기준점의 y 좌표 */
  getBaselineY(): number {
    return this.baselineY
  }

  /** @returns 기준점이 고정(lock)되었는지 여부 */
  isLocked(): boolean {
    return this.locked
  }

  /**
   * 기준점을 외부 값(예: 저장된 캘리브레이션 데이터)으로 강제 설정하고 즉시 lock한다.
   * @param x 설정할 기준점 x 좌표
   * @param y 설정할 기준점 y 좌표
   */
  setBaseline(x: number, y: number): void {
    this.baselineX = x
    this.baselineY = y
    this.locked = true
  }

  /**
   * 고정된 기준점을 alpha 비율의 EMA로 미세 보정한다(드리프트 추적).
   * @param x 현재 프레임의 x 좌표
   * @param y 현재 프레임의 y 좌표
   * @param alpha 보정 강도 (0~1, 클수록 빠르게 반영)
   */
  driftUpdate(x: number, y: number, alpha: number): void {
    this.baselineX = (1 - alpha) * this.baselineX + alpha * x
    this.baselineY = (1 - alpha) * this.baselineY + alpha * y
  }

  /** 기준점 학습 상태를 초기값(0.5, 0.5, unlocked)으로 되돌린다. */
  reset(): void {
    this.baselineX = 0.5
    this.baselineY = 0.5
    this.sampleCount = 0
    this.locked = false
  }
}

const irisBaseline = new IrisBaselineTracker()

/**
 * Bilinear interpolation helper for 3x3 grid offsets
 *
 * @param x 화면 x 좌표 (px)
 * @param y 화면 y 좌표 (px)
 * @param W 화면 전체 너비 (px)
 * @param H 화면 전체 높이 (px)
 * @param grid 3x3 그리드의 셀별 보정 오프셋
 * @returns 해당 (x, y) 위치에 대해 양선형 보간된 오프셋 {offsetX, offsetY}
 */
function interpolateGridOffset(
  x: number,
  y: number,
  W: number,
  H: number,
  grid: { offsetX: number; offsetY: number }[][]
): { offsetX: number; offsetY: number } {
  const rows = 3
  const cols = 3

  const cFloat = (x / W) * cols - 0.5
  const rFloat = (y / H) * rows - 0.5

  const c0 = Math.min(Math.max(Math.floor(cFloat), 0), cols - 1)
  const c1 = Math.min(Math.max(c0 + 1, 0), cols - 1)
  const r0 = Math.min(Math.max(Math.floor(rFloat), 0), rows - 1)
  const r1 = Math.min(Math.max(r0 + 1, 0), rows - 1)

  const tx = cFloat - Math.floor(cFloat)
  const ty = rFloat - Math.floor(rFloat)

  const w00 = (1 - tx) * (1 - ty)
  const w10 = tx * (1 - ty)
  const w01 = (1 - tx) * ty
  const w11 = tx * ty

  const off00 = grid[r0][c0]
  const off10 = grid[r0][c1]
  const off01 = grid[r1][c0]
  const off11 = grid[r1][c1]

  return {
    offsetX: off00.offsetX * w00 + off10.offsetX * w10 + off01.offsetX * w01 + off11.offsetX * w11,
    offsetY: off00.offsetY * w00 + off10.offsetY * w10 + off01.offsetY * w01 + off11.offsetY * w11,
  }
}

/**
 * 눈 깜빡임 감지기.
 *
 * 초기 30프레임(~1초) 동안 정상 개안 상태의 eye openness 기준치를 학습 후 고정.
 *
 * check()  — baseline의 55% 이하 → 프레임 전체 skip (완전 blink)
 * isReliableY() — baseline의 75% 이상 → y좌표 신뢰 가능
 *
 * 설계 의도:
 *   눈꺼풀 하강 transition 구간(55~100%)에서도 iris y좌표가 아래로 왜곡됨.
 *   check()만으로는 transition 구간을 커버 못 하므로,
 *   isReliableY()로 y좌표를 별도 보호 → 커서 y를 마지막 안정값으로 고정.
 */
class BlinkDetector {
  private baselineOpenness = 0
  private sampleCount = 0
  private readonly BASELINE_FRAMES   = 30   // ~1초 학습
  private readonly BLINK_RATIO       = 0.08 // baseline의 8% 이하 → 전체 skip (0.18→0.08: 아래를 내려다볼 때 눈꺼풀 하강으로 좌표 고정되는 문제 방지)
  private readonly RELIABLE_Y_RATIO  = 0.62 // baseline의 62% 미만 → y 신뢰 불가

  /**
   * @param openness 현재 프레임의 눈 개폐 정도 (getEyeOpenness 결과)
   * @returns true = 완전 깜빡임 → 이 프레임 전체 무시
   */
  check(openness: number): boolean {
    if (this.sampleCount < this.BASELINE_FRAMES) {
      this.sampleCount++
      this.baselineOpenness += (openness - this.baselineOpenness) / this.sampleCount
      return false  // 학습 중에는 blink 판정 안 함
    }
    if (this.baselineOpenness <= 0) return false
    return openness < this.baselineOpenness * this.BLINK_RATIO
  }

  /**
   * @param openness 현재 프레임의 눈 개폐 정도 (getEyeOpenness 결과)
   * @returns false = 눈꺼풀 하강 transition 중 → y좌표 신뢰 불가
   */
  isReliableY(openness: number): boolean {
    if (this.sampleCount < this.BASELINE_FRAMES) return true  // 학습 중엔 신뢰
    if (this.baselineOpenness <= 0) return true
    return openness >= this.baselineOpenness * this.RELIABLE_Y_RATIO
  }

  /** baseline 학습 상태를 초기화한다 (다음 30프레임 동안 다시 학습). */
  reset(): void {
    this.baselineOpenness = 0
    this.sampleCount      = 0
  }
}

const blinkDetector = new BlinkDetector()

// 마지막으로 신뢰 가능한 상태에서 관측된 gaze x, y (0~1 normalized)
// 눈 깜빡임 또는 눈꺼풀 하강 transition 시 이 값으로 고정
let lastStableGazeX = 0.5
let lastStableGazeY = 0.5
let postBlinkFrames = 0

// ── GAIN 적용 전 사전 평활화 (pre-gain smoothing) ──────────────────────────
// 문제: GAIN_X=120 / GAIN_Y=35는 iris-relative 변화(±0.01~0.03, 매우 작은 스케일)를
//       tanh 가속으로 화면 전체에 매핑하기 위해 의도적으로 매우 높게 설정되어 있음.
//       이 GAIN은 "의도된 시선 이동"뿐 아니라 랜드마크 추출의 미세한 프레임 간 노이즈
//       (홍채 위치 추정의 sub-pixel jitter)까지 동일하게 수십~수백 px로 증폭시킴.
//       후단 GazeFilterService는 이미 증폭되고 tanh로 비선형 압축된 화면 좌표를 다시
//       평활화하므로 노이즈 억제가 비효율적이고, 캘리브레이션 dwell의 거리/안정성
//       게이트가 간헐적으로 깨져 "게이지가 차다가 마는" 현상의 핵심 원인이 됨.
// 해법: GAIN/tanh 적용 *전*, 작은 스케일(0~1 정규화) 단계에서 가벼운 EMA로 먼저
//       노이즈를 죽인다. 이 단계는 선형적이라 평활화 효율이 훨씬 높고, 실제 시선
//       이동(여러 프레임에 걸쳐 누적되는 진짜 움직임)에는 충분히 빠르게 반응한다.
let smoothedGazeX = 0.5
let smoothedGazeY = 0.5
let gazeSmoothInitialized = false
// 0.35는 9/5/3/1번 등 매번 다른 점에서의 간헐적 stall을 막기엔 부족했음(여전히
// noise가 GAIN_X=120 근처 dx=0에서 최대 기울기를 통과하며 크게 증폭됨).
// 0.18로 더 강하게 죽여 stabilityService(0~100 스케일, threshold=0.35)가 amplified
// noise만으로 깨지는 빈도를 낮춘다. 실제 시선 이동은 dwell 동안 여러 프레임에 걸쳐
// 누적되므로 반응성 저하는 체감상 미미함.
const PRE_GAIN_SMOOTHING_ALPHA = 0.18

// ── 캘리브레이션 중 baseline 강제 재설정(setBaseline) 1회만 적용 ────────────
// 문제: calibrationData는 1번 점(중앙) 캡처 직후 바로 non-null이 되고, 이후
//       모든 프레임에서 매번 irisBaseline.setBaseline(calibrationData.baselineX, Y)가
//       호출되어 baseline을 그 "캡처 당시 고정값"으로 매 프레임 강제 리셋+lock 했음.
//       바로 다음 줄의 driftUpdate(...,0.002)가 미세하게 baseline을 보정해도,
//       다음 프레임에서 setBaseline이 즉시 그 보정을 덮어써 원점으로 되돌려버려
//       drift 보정이 사실상 죽은 코드나 다름없었음.
//       결과: 13점 보정을 진행하는 몇 초~몇십 초 동안 사용자의 자연스러운 미세
//       머리 움직임이 전혀 반영되지 못하고 점점 기준점과 실제 위치가 벌어져,
//       드리프트가 누적된 시점에 도달한 "어떤 점에서든" (9번, 5번 등 매번 다름)
//       거리 게이트가 깨지며 게이지가 멈추는 현상의 실제 원인이었음.
// 해법: 같은 baselineX/Y 값에 대해 setBaseline은 단 1회만 적용하고, 그 이후로는
//       매 프레임 driftUpdate만 누적되도록 허용한다.
let lastAppliedCalibBaselineX: number | null = null
let lastAppliedCalibBaselineY: number | null = null

// ── stability 평가 전용 고정-alpha 스무딩 (velocity trap 회피) ───────────────
// GazeFilterService.applyExponentialSmoothing()은 "이동 거리가 크면 alpha를 높여
// 덜 평활화"하는 속도-적응형 로직이라, GAIN_X=120의 tanh 미분이 최대인 중간값
// 타겟(x=0.28/0.72 등)에서는 증폭된 sub-pixel 노이즈만으로도 프레임당 이동거리가
// 손쉽게 maxDist(180px)를 넘어버림 → alpha가 0.65까지 치솟아 평활이 거의 풀리고,
// 그 결과 다음 프레임도 다시 큰 이동거리로 측정되는 악순환(feedback loop)에 빠져
// stabilityScore가 0 근처에 박혀버리고, 사용자가 점을 가만히 보고 있어도 게이지가
// 영구히 멈춤(5초 이상 무응답으로 보고된 현상과 일치).
// → stability 판정에는 이 속도-적응 로직과 무관한, 고정 alpha의 별도 EMA를 적용해
//   피드백 루프 자체를 차단한다. (cursor 표시용 filtered/uncalibrated 값은 그대로 둬
//   런타임 반응성에 영향 없음)
let stabilitySmoothX = 0.5
let stabilitySmoothY = 0.5
let stabilitySmoothInitialized = false

// next/prev 핫존 판정 전용 평활 좌표.
// "안 보고 있는데도 갑자기 페이지가 넘어간다" 증상의 원인: nextDwellService/
// prevDwellService.evaluate()가 raw한 filtered(calibration 적용) 좌표를 그대로
// region-내부 판정에 사용해서, 노이즈로 한두 프레임만 핫존 경계를 스쳐도 dwell
// 타이머가 시작돼버림. gracePeriod(200ms)는 "한번 시작된 dwell이 잠깐 끊겨도
// 안 죽게"만 해줄 뿐, 애초에 "진짜 의도적으로 핫존을 보고 있는지"는 걸러주지 않음.
// → 핫존 판정에만 쓰는 가벼운 EMA(half-life ≈ 2~3프레임, ~70~100ms)를 추가해서
//   한 프레임짜리 스파이크가 영역에 닿아도 평활값은 거의 안 움직여 dwell이 시작되지
//   않도록 막는다. 진짜로 그 자리를 계속 보고 있으면 몇 프레임 안에 평활값도 같이
//   들어오므로, 800ms 임계값 안에서는 체감되는 지연이 거의 없음.
let dwellSmoothX = 0.5
let dwellSmoothY = 0.5
let dwellSmoothInitialized = false
const DWELL_SMOOTH_ALPHA = 0.5

// "다음 페이지로 넘어간 직후 연속으로 두 페이지가 넘어간다" 증상의 원인:
// 페이지 전환 트리거 시점에 사용자의 실제 시선은 (방금 그 핫존을 800ms 동안
// 바라봐서 넘긴 것이므로) 여전히 핫존 자리에 머물러 있는 경우가 많음. 전환 직후
// nextDwellService.reset()으로 dwell 타이머만 0으로 되돌리는데, 시선이 그 자리에서
// 안 움직였다면 바로 다음 프레임부터 dwellStartTime이 다시 시작돼 새 800ms 카운트가
// 시작됨. NavigatePageUseCase의 쿨다운(600ms)이 dwellThreshold(800ms)보다 짧아서,
// 사용자가 눈을 떼지 않은 채 가만히 있으면 쿨다운이 끝나는 즉시(전환 후 약 800ms)
// 두 번째 전환이 자동으로 또 일어남 — "두 페이지씩 갑자기 넘어감".
// → 한 번 전환을 트리거한 핫존은, 사용자의 시선이 실제로 그 영역을 벗어났다가
//   (=페이지를 다 보고 자연스럽게 눈을 돌렸다는 신호) 다시 들어오기 전까지는
//   완료 신호를 보내지 않도록 "탈출 대기" 플래그로 한 번 더 막는다.
let nextAwaitingExit = false
let prevAwaitingExit = false

/**
 * 주어진 점이 사각형 핫존 영역 내부에 있는지 판정한다.
 *
 * @param point 판정할 점 (화면 좌표)
 * @param region 사각형 영역 경계 (left/right/top/bottom)
 * @returns 영역 내부에 있으면 true
 */
function isInsideHotzoneRect(
  point: { x: number; y: number },
  region: { left: number; right: number; top: number; bottom: number },
): boolean {
  return (
    point.x >= region.left &&
    point.x <= region.right &&
    point.y >= region.top &&
    point.y <= region.bottom
  )
}

// ── 비-중앙 캘리브레이션 점에서는 baseline drift를 절대 적용하지 않음 ─────────────
// (이전에 "정착 구간 + 한도 구간 + anchor 클램프"로 약한 drift를 허용해 13번 점의
//  누적 오차를 보정해보려 했으나, bounded/clamped 버전에서도 7번 점(R-mid, y=0.5 —
//  tanh 민감도가 가장 큰 행)이 재현되어 완전 제거함. 13번 점 문제는 baseline이 아니라
//  CalibrationOverlay의 거리 게이트 허용폭을 점 진행에 따라 넓히는 방식으로 해결한다.)
const STABILITY_SMOOTH_ALPHA = 0.15

/**
 * 현재 프레임의 eye openness 계산 (양쪽 눈꺼풀 높이 평균).
 *
 * MediaPipe 정규화 좌표 기준:
 *   정상 개안: ~0.02–0.04
 *   깜빡임 중: ~0.003–0.008
 *
 * @param landmarks 478개 MediaPipe 얼굴 랜드마크 배열
 * @returns 좌우 눈꺼풀 높이의 평균값 (정규화 좌표 기준)
 */
function getEyeOpenness(landmarks: LandmarkPoint[]): number {
  const leftTop     = landmarks[159]
  const leftBottom  = landmarks[145]
  const rightTop    = landmarks[386]
  const rightBottom = landmarks[374]

  if (!leftTop || !leftBottom || !rightTop || !rightBottom) return 1 // 감지 실패 시 정상으로 취급

  const leftH  = leftBottom.y  - leftTop.y
  const rightH = rightBottom.y - rightTop.y
  return (leftH + rightH) / 2
}

console.log(
  '[Worker] after services',
)
/*
 * iris gaze extraction — 눈 소켓 내 상대 위치 방식
 *
 * 기존 절대 좌표 방식의 문제:
 *   - 눈동자만 움직일 때 변화량이 프레임 대비 1-3%로 매우 작음
 *   - 머리 이동 시 얼굴 전체 이동으로 변화량이 커짐 → 머리 추적처럼 보임
 *
 * 상대 위치 방식:
 *   - 눈꼬리(inner/outer canthus) 간 거리 대비 홍채 위치를 0-1로 정규화
 *   - 눈 소켓 내 이동 범위가 ±20-30%로 훨씬 넓어짐
 *   - 머리 이동(translation)에 독립적 — 눈동자 움직임이 주 신호
 *   - 감도를 2.5x로 낮춰도 화면 전체 커버 가능
 *
 * MediaPipe 478-point landmark indices:
 *   Left eye:  inner canthus=133, outer canthus=33,  iris=468, top=159, bottom=145
 *   Right eye: outer canthus=263, inner canthus=362, iris=473, top=386, bottom=374
 *
 * @param landmarks 478개 MediaPipe 얼굴 랜드마크 배열
 * @returns 정규화된 시선 좌표(x, y, z=0) 또는 눈 소켓 인식 실패 시 null
 */
function extractGazePoint(
  landmarks: LandmarkPoint[],
): LandmarkPoint | null {
  const leftIris  = landmarks[468]
  const rightIris = landmarks[473]

  // 왼쪽 눈 꼬리 (카메라 화면 기준)
  const leftEyeInner  = landmarks[133]  // inner canthus: 코 쪽, 낮은 x
  const leftEyeOuter  = landmarks[33]   // outer canthus: 측두부 쪽, 높은 x
  const leftEyeTop    = landmarks[159]
  const leftEyeBottom = landmarks[145]

  // 오른쪽 눈 꼬리 (카메라 화면 기준)
  const rightEyeOuter = landmarks[263]  // outer canthus: 측두부 쪽, 낮은 x
  const rightEyeInner = landmarks[362]  // inner canthus: 코 쪽, 높은 x
  const rightEyeTop    = landmarks[386]
  const rightEyeBottom = landmarks[374]

  if (
    !leftIris || !rightIris ||
    !leftEyeInner || !leftEyeOuter ||
    !rightEyeOuter || !rightEyeInner ||
    !leftEyeTop || !leftEyeBottom ||
    !rightEyeTop || !rightEyeBottom
  ) {
    return null
  }

  // camera-left eye bounds
  const leftEyeMinX = Math.min(leftEyeInner.x, leftEyeOuter.x)
  const leftEyeMaxX = Math.max(leftEyeInner.x, leftEyeOuter.x)
  const leftEyeWidth = Math.max(leftEyeMaxX - leftEyeMinX, 0.0001)

  // camera-right eye bounds
  const rightEyeMinX = Math.min(rightEyeInner.x, rightEyeOuter.x)
  const rightEyeMaxX = Math.max(rightEyeInner.x, rightEyeOuter.x)
  const rightEyeWidth = Math.max(rightEyeMaxX - rightEyeMinX, 0.0001)

  // 눈 소켓이 너무 좁으면 null 반환 (머리가 많이 돌아갔거나 얼굴이 너무 멀 때)
  // 임계값 0.0008: 극단적으로 먼 거리나 노이즈 상황에서도 감지 가능하도록 완화
  if (leftEyeWidth < 0.0008 || rightEyeWidth < 0.0008) {
    return null
  }

  // camera-left eye relative position (0=left edge, 1=right edge of eye socket)
  const leftRelX  = (leftIris.x  - leftEyeMinX)  / leftEyeWidth
  // camera-right eye relative position (0=left edge, 1=right edge of eye socket)
  const rightRelX = (rightIris.x - rightEyeMinX) / rightEyeWidth

  // 평균 상대 위치 (0=카메라 좌, 1=카메라 우)
  const avgRelX = (leftRelX + rightRelX) / 2
  // 미러링 방향 조정: avgRelX는 카메라 기준이므로 좌우가 반대입니다.
  // 유저가 왼쪽을 보면 camera-right(avgRelX가 1에 가까움)로 움직이므로, 화면 왼쪽(x=0)에 매핑하기 위해 반전시킵니다.
  const mirroredX = 1 - avgRelX

  // 진단 로그: iris relative 실제 이동 범위 확인 (100프레임마다 1회)
  if (Math.random() < 0.01) {
    console.log(`[IrisRel] avgRelX=${avgRelX.toFixed(3)} mirroredX=${mirroredX.toFixed(3)} leftW=${leftEyeWidth.toFixed(3)} rightW=${rightEyeWidth.toFixed(3)}`)
  }

  // 수직: 눈 구석(canthi) 중심점 기준 홍채의 상대적 수직 편차 계산
  // 눈꼬리(133, 33, 362, 263)는 뼈대 고정점이라 눈을 깜빡이거나 내려다볼 때 눈꺼풀과 달리 움직이지 않고 안정적입니다.
  const leftEyeCenterY  = (leftEyeInner.y + leftEyeOuter.y) / 2
  const rightEyeCenterY = (rightEyeInner.y + rightEyeOuter.y) / 2

  const leftRelY  = (leftIris.y  - leftEyeCenterY)  / leftEyeWidth
  const rightRelY = (rightIris.y - rightEyeCenterY) / rightEyeWidth
  
  // 홍채는 정면 주시 시 눈꼬리 중심선보다 해부학적으로 약간 위(안구 너비의 약 11% 수준)에 위치하므로,
  // 0.11을 더해 정면 주시 좌표가 0(중앙) 근처가 되도록 정렬합니다.
  const avgRelY = (leftRelY + rightRelY) / 2 + 0.11

  // 홍채의 수직 이동 범위는 보통 안구 너비의 ±12% 내외이지만, 실제 눈동자 상하 회전 범위는 약 ±4~5% 수준입니다.
  // transformToScreen의 비선형 가속(tanh)에 알맞은 입력 스케일로 매핑하여 화면 끝까지 도달할 수 있도록 1.6을 곱해 줍니다.
  const SENSITIVITY_Y = 1.6
  const stableY = 0.5 + avgRelY * SENSITIVITY_Y

  return {
    x: Math.min(Math.max(mirroredX, 0), 1),
    y: Math.min(Math.max(stableY, 0), 1),
    z: 0,
  }
}


/*
 * Worker message handler
 */

/** INIT 메시지: 워커 준비 확인 요청 → INIT_ACK 응답. */
type WorkerInitMessage = {
  type: 'INIT'
}

/** RESET_BASELINE 메시지: 페이지 이동 등으로 시선 추정 파이프라인 전체를 초기 상태로 리셋. */
type WorkerResetBaselineMessage = {
  type: 'RESET_BASELINE'
}

/**
 * gazePipeline.worker가 수신하는 메시지 유니온.
 * INIT/RESET_BASELINE 외의 나머지 케이스는 GazeWorkerInput(프레임별 좌표 계산 요청)이다.
 * SET_DWELL_THRESHOLD는 별도 타입 선언 없이 onmessage 내부에서 런타임 분기로 처리된다.
 */
type WorkerMessage =
  | WorkerInitMessage
  | WorkerResetBaselineMessage
  | GazeWorkerInput

self.onerror = (error) => {
  console.error(
    '[Worker Global Error]',
    error,
  )
}

self.onunhandledrejection = (
  event,
) => {
  console.error(
    '[Worker Rejection]',
    event.reason,
  )
}

/*
 * 워커 메시지 프로토콜 (메인 스레드 → 워커), 분기 순서대로:
 *   INIT               : 워커 로드 확인 → INIT_ACK 응답 후 종료
 *   SET_DWELL_THRESHOLD : 설정 페이지에서 드웰(페이지 넘김) 임계값(ms) 실시간 변경
 *   RESET_BASELINE      : 페이지 이동 시 baseline/blink/filter/dwell 등 전체 파이프라인 상태 초기화
 *   (그 외)             : GazeWorkerInput으로 간주 — 랜드마크를 받아 시선 좌표를 계산하고
 *                         GazeWorkerOutput을 postMessage로 반환 (메인 처리 경로)
 * 모든 분기는 동일한 try/catch로 감싸져 있어, 처리 중 예외가 발생해도 워커 자체는
 * 죽지 않고 콘솔에 에러만 로그된다(self.onerror/onunhandledrejection은 별도 전역 핸들러).
 */
self.onmessage = (
  event: MessageEvent<WorkerMessage>,
) => {
  try {
    const data = event.data as any

    if (
      data &&
      data.type === 'INIT'
    ) {
      console.log('[Worker] INIT received → sending INIT_ACK')
      self.postMessage({
        type: 'INIT_ACK',
      })
      return
    }

    if (data && data.type === 'SET_DWELL_THRESHOLD') {
      const ms = Number(data.ms)
      if (Number.isFinite(ms) && ms > 0) {
        dwellThresholdMs = ms
        console.log('[Worker] ⏱ dwellThreshold 변경:', dwellThresholdMs, 'ms')
      }
      return
    }

    if (data && data.type === 'RESET_BASELINE') {
      irisBaseline.reset()
      blinkDetector.reset()
      lastStableGazeX = 0.5
      lastStableGazeY = 0.5
      postBlinkFrames = 0
      // pre-gain EMA 상태도 함께 리셋 (이전 페이지 잔류 평활값 제거)
      smoothedGazeX = 0.5
      smoothedGazeY = 0.5
      gazeSmoothInitialized = false
      // 강제 baseline 적용 추적값도 리셋 → 새 캘리브레이션 시작 시 setBaseline 재적용 허용
      lastAppliedCalibBaselineX = null
      lastAppliedCalibBaselineY = null
      // 페이지 이동 후 dwell 타이머 리셋 → 핫존이 즉시 0%로 초기화
      nextDwellService.reset()
      prevDwellService.reset()
      // 페이지 이동 직후 연속 페이지 넘김 방지: 탈출 대기 플래그 잠금
      nextAwaitingExit = true
      prevAwaitingExit = true
      // EMA 필터 버퍼 + stability 히스토리 리셋 → 이전 페이지 잔류 좌표 제거
      filterService.reset()
      stabilityService.reset()
      stabilitySmoothX = 0.5
      stabilitySmoothY = 0.5
      stabilitySmoothInitialized = false
      dwellSmoothX = 0.5
      dwellSmoothY = 0.5
      dwellSmoothInitialized = false
      console.log('[Worker] 🔄 전체 파이프라인 리셋 (페이지 이동)')
      return
    }

    const {
      landmarks,
      screen,
      calibrationData,
      isCalibrating,
      pdfBounds,
      currentPointIndex,
      isNavigationPaused,
    } =
      event.data as GazeWorkerInput & { currentPointIndex?: number; isNavigationPaused?: boolean }

    /*
     * 눈 깜빡임 감지 (complete blink): openness < baseline 50% → 프레임 전체 skip 및 좌표 고정
     */
    const eyeOpenness = getEyeOpenness(landmarks)
    const isBlinking = blinkDetector.check(eyeOpenness)
    const yReliable = blinkDetector.isReliableY(eyeOpenness)

    // headPose: output 전송용으로만 계산 (skip 조건으로 사용 안 함)
    const headPose = headPoseEstimator.estimate({ points: landmarks } as any)

    /*
     * iris gaze extraction
     */
    let gazeLandmark = extractGazePoint(landmarks)

    // 눈 깜빡임(Blink) 또는 랜드마크 추출 실패 시 마지막 안정 좌표 사용
    const needsFallback = isBlinking || !gazeLandmark

    if (needsFallback) {
      gazeLandmark = {
        x: lastStableGazeX,
        y: lastStableGazeY,
        z: 0,
      }
      postBlinkFrames = 3 // 깜빡임 감지 시 포스트-블링크 프레임 수 예약
    } else {
      if (postBlinkFrames > 0) {
        // 깜빡임 직후 2~3프레임 동안은 선형 보간하여 급격한 U자형 흔들림 방지
        const ratio = 1 - postBlinkFrames * 0.25 // postBlinkFrames가 3, 2, 1일 때 ratio는 0.25, 0.5, 0.75
        postBlinkFrames--
        gazeLandmark!.x = lastStableGazeX + (gazeLandmark!.x - lastStableGazeX) * ratio
        gazeLandmark!.y = lastStableGazeY + (gazeLandmark!.y - lastStableGazeY) * ratio
      }

      // 아래쪽을 응시할 때 눈꺼풀이 자연스럽게 내려와 iris y가 실제 시선보다
      // 더 아래로 왜곡되는 transition 구간(완전 blink 아님, BlinkDetector.check()는
      // false 반환) → isReliableY()로 감지해 y만 마지막 안정값으로 고정.
      // (이전에는 isReliableY가 정의만 되고 한 번도 호출되지 않아 죽은 코드였음 —
      //  하단부 보정점(9, 10, 11, 12번 등 y가 큰 점)에서 게이지가 차다가 멈추는
      //  원인이었음: 왜곡된 y가 lastStableGazeY에도 누적 저장되어 기준점 자체가 오염됨)
      if (!yReliable) {
        gazeLandmark!.y = lastStableGazeY
      } else {
        lastStableGazeY = gazeLandmark!.y
      }
      lastStableGazeX = gazeLandmark!.x
    }

    /*
     * GAIN(120x/35x) 적용 전 사전 평활화 — iris-relative 정규화 스케일에서 EMA.
     * blink fallback 프레임(needsFallback)에는 적용하지 않고 직전 평활값을 그대로 유지
     * (lastStable* 값은 이미 안정 좌표이므로 추가 평활 불필요 + lock 끊김 방지).
     */
    if (!gazeSmoothInitialized) {
      smoothedGazeX = gazeLandmark!.x
      smoothedGazeY = gazeLandmark!.y
      gazeSmoothInitialized = true
    } else if (!needsFallback) {
      smoothedGazeX += (gazeLandmark!.x - smoothedGazeX) * PRE_GAIN_SMOOTHING_ALPHA
      smoothedGazeY += (gazeLandmark!.y - smoothedGazeY) * PRE_GAIN_SMOOTHING_ALPHA
    }
    gazeLandmark!.x = smoothedGazeX
    gazeLandmark!.y = smoothedGazeY

    /*
     * 자동 중심 보정
     *
     * 캘리브레이션 중(isCalibrating)이거나 보정 데이터가 있는 경우에는 기준점을 0.5로 고정하여
     * 일관성 있는 좌표 변환 공간을 유지함으로써 캘리브레이션 정합성이 깨지는 것을 방지합니다.
     * 그렇지 않은 일반 모드에서는 초기 1초 동안 기준점을 학습해 편향을 보정합니다.
     */
    // 재캘리브레이션 중 0번(중앙)점 진행 중에는 이전 calibrationData의 baseline을
    // 절대 복원/강제하지 않는다 — RESET_BASELINE으로 막 초기화된 baseline을 곧바로
    // "예전" 값으로 되돌려 버리면 0번점이 새로운 머리 위치에서 다시 학습할 기회를
    // 영영 갖지 못해 distance 게이트가 깨지거나(혹은 매우 오래) force_progress로만
    // 넘어가는 문제가 있었음 — 사용자 리포트: 재캘리브레이션 시 0번 점에서 멈춤/매우
    // 오래 걸림. 0번점이 끝나고 1번 이후로 넘어가면 다시 정상적으로 복원/고정한다.
    const isRelearningCenter = isCalibrating && currentPointIndex === 0

    // Restore baseline from calibrationData if present — 동일 baseline 값에 대해 1회만 강제 설정
    if (
      !isRelearningCenter &&
      calibrationData && calibrationData.baselineX !== undefined && calibrationData.baselineY !== undefined
    ) {
      if (
        lastAppliedCalibBaselineX !== calibrationData.baselineX ||
        lastAppliedCalibBaselineY !== calibrationData.baselineY
      ) {
        irisBaseline.setBaseline(calibrationData.baselineX, calibrationData.baselineY)
        lastAppliedCalibBaselineX = calibrationData.baselineX
        lastAppliedCalibBaselineY = calibrationData.baselineY
      }
    }

    // 캘리브레이션 중이 아니거나, 캘리브레이션 중이더라도 첫 번째 점(중앙점)일 때는 기준점을 학습합니다.
    const isOffCenterCalibrationPoint = isCalibrating && currentPointIndex !== 0
    const skipBaselineUpdate = isOffCenterCalibrationPoint || (calibrationData != null && !isRelearningCenter)

    if (!needsFallback) {
      if (skipBaselineUpdate) {
        // 9/5/3/1/7번 등 매번 다른 점에서 게이지가 "차다가 멈추는" 문제의 실제 원인:
        // 캘리브레이션 중 비-중앙점(점1~12)에서는 사용자가 의도적으로 화면 구석을
        // 보고 있는데, 이 raw 위치를 driftUpdate로 baseline에 끌어당기면(bounded여도
        // 마찬가지) dx(=raw-baseline)가 점점 0으로 수렴 → 변환된 좌표가 타겟에서
        // 점점 멀어져 distance 게이트가 깨짐. 특히 y=0.5(센터 행, 7/13번)는 tanh
        // 민감도가 가장 큰 구간이라 점당 한도+클램프를 걸어도 아주 작은 baseline
        // 이동만으로 게이트가 즉시 깨짐 — bounded/clamped 버전도 재현됨(7번 재발 확인).
        // → off-center 구간 동안은 baseline을 절대 건드리지 않는다(완전 skip).
        //   13번 점의 "전체 시퀀스 동안 drift 보정 0" 문제는 baseline을 고치는 대신
        //   CalibrationOverlay의 거리 게이트 허용폭을 점 진행에 따라 조금씩 넓혀
        //   해결한다 (이 파일이 아닌 CalibrationOverlay.tsx에서 처리).
        if (!isOffCenterCalibrationPoint) {
          irisBaseline.driftUpdate(gazeLandmark!.x, gazeLandmark!.y, 0.002)
        }
      } else {
        irisBaseline.update(gazeLandmark!.x, gazeLandmark!.y)

        // 점0(중앙점) 학습 윈도우(LOCK_AFTER_FRAMES=30, ~1초)가 사용자가 아직 자세를
        // 잡기 전(화면 전환 직후 놀람, 블링크, 자세 조정 등)과 겹치면 잘못된 값으로
        // baseline이 영구 lock되고, update()는 locked 이후 완전히 no-op이라 그
        // 오프셋을 되돌릴 방법이 전혀 없어 점0의 dwell이 끝까지 통과하지 못하고
        // "첫 번째 점에서 멈추는" 문제가 있었음.
        // → lock된 이후에도 점0 동안은 미세 drift 보정을 계속 허용해 초기 lock이
        //   다소 어긋났더라도 사용자가 실제로 응시를 유지하면 서서히 맞춰지게 한다.
        if (irisBaseline.isLocked()) {
          irisBaseline.driftUpdate(gazeLandmark!.x, gazeLandmark!.y, 0.01)
        }
      }
    }
    
    // Always center coordinates relative to baseline to prevent tanh saturation
    const centeredLandmark = irisBaseline.getCentered(gazeLandmark!.x, gazeLandmark!.y)
      
    const landmarkForTransform = {
      x: centeredLandmark.x,
      y: centeredLandmark.y,
      z: gazeLandmark!.z,
    }

    // 고정 GAIN (calibration scale 보정은 이후 offset/scale 단계에서 처리)
    //
    // GAIN_Y: 실측 기준 최대 하방 주시 시 dy ≈ 0.054.
    //   - GAIN_Y=120 → tanh(6.5)≈1.0: 즉시 포화, y=0.78·y=0.95 구분 불가 → 캘리브 불정확
    //   - GAIN_Y=15  → tanh(0.81)≈0.672: 커서 87%까지만 도달, 6/6 영역 미진입
    //   - GAIN_Y=35  → tanh(1.89)≈0.956: 커서 97.8%까지 도달, 캘리브 포인트 구분 가능 ✓
    //
    // 문제: GAIN_X=120 vs GAIN_Y=35는 3.4배 차이라, 가로로 읽다가 다음 줄로 내려가는
    // "보통 크기"의 수직 시선 이동(다음 줄 이동은 화면 끝까지 내려보는 dy_max=0.054보다
    // 훨씬 작은 dy)에서는 같은 물리적 눈동자 회전량 대비 화면 이동량이 X보다 훨씬 작게
    // 나와 "아래로 안 내려가려는" 듯한 저항감으로 느껴짐.
    // 해법: GAIN_Y를 35→45로 올려 보통 크기 dy의 반응성을 높인다. dy_max=0.054 기준
    // tanh(45*0.054)=tanh(2.43)≈0.984(98.4% 커버)로 여전히 포화 전이고, y=0.78
    // (dy=0.035)는 tanh(45*0.035)=tanh(1.575)≈0.917(91.7%)이라 0.78/0.95 두 점 구분도
    // 유지된다(차이는 6%→3%p로 줄지만 여전히 화면상 수십 px 차이로 분간 가능).
    //
    // tanh 특성 (GAIN_Y=45, dy_max≈0.054 기준):
    //   dy=±0.035 → tanh(±1.575) ≈ ±0.917 → 화면 91.7% 커버 (y=0.78 포인트)
    //   dy=±0.054 → tanh(±2.430) ≈ ±0.984 → 화면 98.4% 커버 (y=0.95 포인트)
    //
    // GAIN_X 버그(실제 세션 로그로 확인, 2026-06-16 마지막 완료 세션 분석):
    // "X는 변화가 작으니 게인을 높게 유지한다"는 기존 가정과 달리, 실측 dx 범위가
    // ±0.01~0.03인데 GAIN_X=120을 곱하면 tanh(120*0.01)=tanh(1.2)≈0.837(84%)부터
    // 시작해 tanh(120*0.03)=tanh(3.6)≈0.9985(99.85%)까지 — 즉 실제 사용되는 dx 전
    // 구간이 84~99.85%라는 좁은 띠에 몰려버려, x=0.28·0.72(가운데 쪽) 점도 거의
    // 화면 끝(가장자리)에 붙은 좌표로 찍힘. 그 결과 해당 점들에서 edge 게이트가
    // 매 프레임 실패해 9초 강제진행(force_progress)이 반복되고, 그 망가진 좌표가
    // 그대로 polyCoeffsX 학습에 들어가 캘리브레이션 품질이 0으로 떨어짐(점
    // 2/4/6/8/10/12 모두 edge 실패 80~170회 + force_progress, quality_score 0).
    // 반면 코너 점(x=0.05/0.95)은 edge 게이트 자체가 면제돼 있어 영향이 없었고,
    // 그래서 코너만 멀쩍이 빠르게(1~5초) 끝나는 게 로그에 그대로 드러났음.
    //
    // 해법: Y축과 동일한 방식으로 재계산. corner dx_max≈0.03이 약 90% 커버에
    // 도달하도록 GAIN_X = atanh(0.9)/0.03 ≈ 49 → 50으로 낮춘다. 이 값이면
    // mid 점(dx≈0.01)도 tanh(50*0.01)=tanh(0.5)≈0.462(46%)로, 실제 목표(x=0.28/0.72)
    // 부근에 합리적으로 분산되어 더 이상 edge에 들러붙지 않는다.
    const GAIN_X = 50.0
    const GAIN_Y = 45.0

    /*
     * normalized → screen coordinates 좌표 변환
     */
    const raw =
      coordinateService.transformToScreen(
        landmarkForTransform,
        screen,
        // 캘리브레이션 중에는 dy 데드존을 끄고 raw 신호를 그대로 써서 점 구분 정확도를
        // 지킨다 (데드존을 켜 둔 채 캘리브레이션하면 9번 점처럼 사용자별 dy가 데드존
        // 근처일 때 신호가 과도하게 깎여 거리 게이트가 영구히 실패함).
        { gainX: GAIN_X, gainY: GAIN_Y, ySoftZone: !isCalibrating },
      )

    // calibrated raw for compatibility with rawGaze debug display
    const calibratedRaw = {
      x: raw.x,
      y: raw.y,
      timestamp: raw.timestamp,
    }

    if (calibrationData) {
      if (calibrationData.polyCoeffsX && calibrationData.polyCoeffsY) {
        const px = calibrationData.polyCoeffsX
        const py = calibrationData.polyCoeffsY
        const rx = raw.x / screen.width
        const ry = raw.y / screen.height

        const txNorm = px[0] * rx * rx + px[1] * rx + px[2] * ry + px[3]
        const tyNorm = py[0] * ry * ry + py[1] * ry + py[2] * rx + py[3]

        let tx = txNorm * screen.width
        let ty = tyNorm * screen.height

        if (calibrationData.gridOffsets) {
          const localOff = interpolateGridOffset(tx, ty, screen.width, screen.height, calibrationData.gridOffsets)
          tx += localOff.offsetX
          ty += localOff.offsetY
        }

        calibratedRaw.x = tx
        calibratedRaw.y = ty
      } else {
        // Fallback to linear
        const screenScaleX = screen.width / (calibrationData.screenWidth || screen.width)
        const screenScaleY = screen.height / (calibrationData.screenHeight || screen.height)
        const scaledOffsetX = calibrationData.offsetX * screenScaleX
        const scaledOffsetY = calibrationData.offsetY * screenScaleY
        calibratedRaw.x = raw.x * calibrationData.scaleX + scaledOffsetX
        calibratedRaw.y = raw.y * calibrationData.scaleY + scaledOffsetY
      }
    }
    calibratedRaw.x = Math.min(Math.max(calibratedRaw.x, 0), screen.width)
    calibratedRaw.y = Math.min(Math.max(calibratedRaw.y, 0), screen.height)

    /*
     * smoothing/filter 적용 (보정 전 원본 좌표 기준 필터링)
     */
    const filteredUncalibrated = filterService.filter(raw)
    const uncalibrated = {
      x: Math.min(Math.max(filteredUncalibrated.x, 0), screen.width),
      y: Math.min(Math.max(filteredUncalibrated.y, 0), screen.height),
      timestamp: filteredUncalibrated.timestamp,
    }

    /*
     * 캘리브레이션 적용
     */
    let cx = filteredUncalibrated.x
    let cy = filteredUncalibrated.y

    if (calibrationData) {
      if (calibrationData.polyCoeffsX && calibrationData.polyCoeffsY) {
        const px = calibrationData.polyCoeffsX
        const py = calibrationData.polyCoeffsY
        const rx = filteredUncalibrated.x / screen.width
        const ry = filteredUncalibrated.y / screen.height

        const txNorm = px[0] * rx * rx + px[1] * rx + px[2] * ry + px[3]
        const tyNorm = py[0] * ry * ry + py[1] * ry + py[2] * rx + py[3]

        let tx = txNorm * screen.width
        let ty = tyNorm * screen.height

        if (calibrationData.gridOffsets) {
          const localOff = interpolateGridOffset(tx, ty, screen.width, screen.height, calibrationData.gridOffsets)
          tx += localOff.offsetX
          ty += localOff.offsetY
        }

        cx = tx
        cy = ty
      } else {
        // Fallback to linear
        const screenScaleX = screen.width / (calibrationData.screenWidth || screen.width)
        const screenScaleY = screen.height / (calibrationData.screenHeight || screen.height)
        const scaledOffsetX = calibrationData.offsetX * screenScaleX
        const scaledOffsetY = calibrationData.offsetY * screenScaleY

        const tx = filteredUncalibrated.x * calibrationData.scaleX + scaledOffsetX
        const ty = filteredUncalibrated.y * calibrationData.scaleY + scaledOffsetY

        const maxX = screen.width  * 1.5
        const maxY = screen.height * 1.5
        const isScaleInvalid =
          calibrationData.scaleX < 0.2 ||
          calibrationData.scaleX > 2.2 ||
          calibrationData.scaleY < 0.2 ||
          calibrationData.scaleY > 2.2

        if (!(tx < -maxX || tx > maxX || ty < -maxY || ty > maxY || isScaleInvalid)) {
          cx = tx
          cy = ty
        }
      }
    }

    // 화면 범위로 clamp (절대 화면 밖으로 나가지 않게)
    const filtered = {
      x: Math.min(Math.max(cx, 0), screen.width),
      y: Math.min(Math.max(cy, 0), screen.height),
      timestamp: filteredUncalibrated.timestamp,
    }

    /*
     * stability analysis
     *
     * 캘리브레이션 중 captureSample()이 매 점마다 RLS(polyCoeffsX/Y)를 즉시 갱신하는데,
     * RlsFilter는 initialDelta=1000(매우 큰 초기 공분산)으로 시작해 샘플이 적을 때
     * 단 1개의 새 샘플에도 가중치가 크게 튐(overfit) — 다항식 계수가 한 프레임 만에
     * 크게 바뀌면 calibration이 적용된 filtered 좌표도 실제 시선이 가만히 있어도
     * 순간적으로 크게 점프함.
     * stability는 "calibration된 최종 위치"가 아니라 "시선 자체의 흔들림"을 측정하는
     * 목적이므로, calibration 모델의 학습 transient에 영향받지 않는 uncalibrated
     * 스트림을 기준으로 평가한다. (CalibrationOverlay의 거리 판정도 동일하게
     * uncalibratedGaze를 쓰고 있어 — 일관성 있음)
     * nextDwellService/prevDwellService는 여전히 filtered(calibration 적용 위치)를
     * 써야 하므로 영향 없음 — 이 둘은 RLS가 더 이상 갱신되지 않는 평상시(보정 완료 후)
     * 에만 실질적으로 동작하는 흐름이라 안전함.
     */
    if (!stabilitySmoothInitialized) {
      stabilitySmoothX = uncalibrated.x
      stabilitySmoothY = uncalibrated.y
      stabilitySmoothInitialized = true
    } else {
      stabilitySmoothX += (uncalibrated.x - stabilitySmoothX) * STABILITY_SMOOTH_ALPHA
      stabilitySmoothY += (uncalibrated.y - stabilitySmoothY) * STABILITY_SMOOTH_ALPHA
    }

    stabilityService.addSample({
      x: stabilitySmoothX,
      y: stabilitySmoothY,
      timestamp: uncalibrated.timestamp,
    })


    const stabilityResult =
      stabilityService.evaluate()

    /*
     * dwell regions (Next: Bottom 20% + Right 25% of pdf, Prev: Top 15% of pdf)
     */
    const bounds = pdfBounds || {
      x: 0,
      y: 0,
      width: screen.width,
      height: screen.height,
    }

    const nextRegion = {
      type: 'rect' as const,
      left: bounds.x + bounds.width * 0.75,         // 악보 우측 25%
      right: bounds.x + bounds.width,
      top: bounds.y + bounds.height * (5 / 6),      // 악보 마지막 1/6 (5/6 ≈ 83.3%)
      bottom: bounds.y + bounds.height,
    }

    const prevRegion = {
      type: 'rect' as const,
      left: bounds.x,
      right: bounds.x + bounds.width,
      top: bounds.y,
      bottom: bounds.y + bounds.height * 0.15, // 악보 상단 15%
    }

    /*
     * dwell detection
     *
     * region-내부 판정은 filtered를 그대로 쓰지 않고, 핫존 전용 EMA(dwellSmoothX/Y)를
     * 거친 좌표로 한다 — 위 dwellSmoothX/Y 선언부 주석 참고.
     */
    if (!dwellSmoothInitialized) {
      dwellSmoothX = filtered.x
      dwellSmoothY = filtered.y
      dwellSmoothInitialized = true
    } else {
      dwellSmoothX += (filtered.x - dwellSmoothX) * DWELL_SMOOTH_ALPHA
      dwellSmoothY += (filtered.y - dwellSmoothY) * DWELL_SMOOTH_ALPHA
    }

    const dwellPoint = {
      x: dwellSmoothX,
      y: dwellSmoothY,
      timestamp: filtered.timestamp,
    }

    const nextDwellResult =
      nextDwellService.evaluate(
        dwellPoint,
        nextRegion,
        { dwellThreshold: dwellThresholdMs },
      )

    const prevDwellResult =
      prevDwellService.evaluate(
        dwellPoint,
        prevRegion,
        { dwellThreshold: dwellThresholdMs },
      )

    /*
     * 탈출 대기(awaiting-exit) 게이트 — 위 nextAwaitingExit/prevAwaitingExit 선언부 주석 참고.
     * 한 번 전환을 발동시킨 핫존은, 실제 시선이 그 영역을 벗어나기 전까지는
     * 다시 완료 신호를 내보내지 않는다. 영역을 벗어나는 즉시 플래그를 해제한다.
     */
    const nextInside = isInsideHotzoneRect(dwellPoint, nextRegion)
    const prevInside = isInsideHotzoneRect(dwellPoint, prevRegion)

    if (!nextInside) nextAwaitingExit = false
    if (!prevInside) prevAwaitingExit = false

    // 만약 인지적 휴지기(페이지 전환 일시정지) 중이라면, 모든 드웰 진행률 및 트리거를 강제로 리셋하고 차단한다.
    if (isNavigationPaused) {
      nextDwellService.reset()
      prevDwellService.reset()
      nextAwaitingExit = true
      prevAwaitingExit = true
    }

    const nextReadyToFire =
      stabilityResult.isStable &&
      nextDwellResult.completed &&
      !nextAwaitingExit &&
      !isNavigationPaused

    const prevReadyToFire =
      stabilityResult.isStable &&
      prevDwellResult.completed &&
      !prevAwaitingExit &&
      !isNavigationPaused

    if (nextReadyToFire) {
      nextAwaitingExit = true
      nextDwellService.reset()
    }

    if (prevReadyToFire) {
      prevAwaitingExit = true
      prevDwellService.reset()
    }

    /*
     * 최종 output
     */
    const output: GazeWorkerOutput = {
      fps: 30,

      headPose,

      raw: {
        ...calibratedRaw,

        confidence: needsFallback ? 0 : 1,

        isStable:
          stabilityResult.isStable,

        stabilityScore:
          stabilityResult.stabilityScore,
      },

      filtered: {
        ...filtered,

        confidence: needsFallback ? 0 : 1,

        isStable:
          stabilityResult.isStable,

        stabilityScore:
          stabilityResult.stabilityScore,
      },

      uncalibrated: {
        ...uncalibrated,
        // CalibrationOverlay의 거리/가장자리 판정도 이 필드(uncalibratedGaze)를 그대로
        // 쓰는데, 기존 uncalibrated.x/y는 GazeFilterService의 속도-적응형 EMA를 거친
        // 값이라 stability와 똑같은 feedback-loop(증폭 노이즈 → 큰 이동거리로 오인 →
        // 평활 약화 → 더 큰 흔들림) 위험에 노출돼 있었음. stability는 고정-alpha
        // 스무딩으로 고쳤지만 distance 판정은 여전히 노이즈에 취약한 값을 보고 있어
        // 같은 증상(점3/점5 등 임의 지점에서 영구 stall)이 재발함.
        // → 거리 판정도 동일한 고정-alpha 스무딩 값(stabilitySmoothX/Y)을 쓰도록 통일.
        x: Math.min(Math.max(stabilitySmoothX, 0), screen.width),
        y: Math.min(Math.max(stabilitySmoothY, 0), screen.height),

        confidence: needsFallback ? 0 : 1,

        isStable:
          stabilityResult.isStable,

        stabilityScore:
          stabilityResult.stabilityScore,
      },


      shouldNavigateNext:
        nextReadyToFire,

      shouldNavigatePrev:
        prevReadyToFire,

      nextProgress:
        nextAwaitingExit ? 0 : nextDwellResult.progress,

      prevProgress:
        prevAwaitingExit ? 0 : prevDwellResult.progress,

      baselineX: irisBaseline.getBaselineX(),
      baselineY: irisBaseline.getBaselineY(),
      isBaselineLocked: irisBaseline.isLocked(),
    }

    self.postMessage(output)
  } catch (error) {
    /*
     * Worker runtime error
     */
    console.error(
      '[gazePipeline.worker]',
      error,
    )
  }
}

export {}
