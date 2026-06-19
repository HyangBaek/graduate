// src/presentation/state/gazeStore.ts

import { create } from 'zustand'
import type { GazePoint, DetectedGazePoint, } from '@/domain/models/GazePoint'
import type { TrackingStats } from '@/presentation/types/TrackingStats'
import { subscribeWithSelector } from 'zustand/middleware'
import { useDebugStore } from '@/presentation/store/useDebugStore'

/**
 * Store State
 */
export interface GazeState {
  /**
   * 원본 시선 좌표
   * MediaPipe / WebEyeTrack 결과 그대로 저장
   */
  rawGaze: DetectedGazePoint | null

  /**
   * 필터링 완료 좌표
   * UI는 이것만 사용 권장
   */
  filteredGaze: GazePoint | null

  /**
   * 보정되기 전 필터링 완료 좌표 (캘리브레이션 캡처용)
   */
  uncalibratedGaze: GazePoint | null


  /**
   * 현재 추적 상태
   */
  isTracking: boolean

  /**
   * 얼굴 감지 여부
   */
  isFaceDetected: boolean

  /**
   * 신뢰도
   * 0 ~ 1
   */
  confidence: number

  /**
   * 디버깅/성능 측정
   */
  stats: TrackingStats

  /**
   * 최근 업데이트 시간
   */
  lastUpdated: number | null

  /** 다음 페이지로 넘어가야 하는지 여부 (드웰/핫존 트리거 결과) */
  shouldNavigateNext: boolean
  /** 이전 페이지로 넘어가야 하는지 여부 (드웰/핫존 트리거 결과) */
  shouldNavigatePrev: boolean
  /** 다음 페이지 핫존 드웰 진행률 (0~1) */
  nextProgress: number
  /** 이전 페이지 핫존 드웰 진행률 (0~1) */
  prevProgress: number
  /** 현재 렌더링된 PDF 캔버스의 화면상 위치/크기 (커서 clamp 등에 사용) */
  pdfBounds: { x: number; y: number; width: number; height: number } | null

  /**
   * GazeCursor가 실제로 화면에 그리는(보간/평활 + clamp 적용 완료) 위치.
   * filteredGaze는 보정 전 원본 신호이고, 실제 사용자가 보는 커서 움직임은
   * GazeCursor.tsx의 rAF 루프에서 EASE 보간과 pdfBounds clamp를 거친 뒤의
   * 값(cx, cy)이다 — 디버깅/분석을 위해 그 최종 위치를 매 프레임 이 필드에 기록한다.
   */
  cursorDisplayPos: GazePoint | null
  /** GazeCursor가 화면 모서리에 클램프(벽을 타고 있는지)되었는지 여부 */
  isCursorClamped: boolean

  /**
   * 페이지 이동 직후 인지적 휴지기 (Cognitive Pause)
   * Date.now() + durationMs로 설정, 이 시간까지는 커서를 화면 중앙으로 리셋
   */
  navigationPauseUntil: number | null

  /**
   * 페이지 이동 시 irisBaseline 리셋 트리거
   * 값이 증가할 때마다 GazeRuntime이 Worker에 RESET_BASELINE 전송
   */
  baselineResetTrigger: number

  /** 카메라 스트림 준비 완료 여부 */
  cameraReady: boolean
  /** 카메라 해상도 문자열 (예: "1280x720") */
  cameraResolution: string | null
  /** 감지된 얼굴 랜드마크 개수 */
  landmarkCount: number
  /** 머리 자세(yaw/pitch/roll) 추정값 */
  headPose: { yaw: number; pitch: number; roll: number } | null

  /** iris 기준 baseline의 x 좌표 (정규화) */
  baselineX: number
  /** iris 기준 baseline의 y 좌표 (정규화) */
  baselineY: number

  /**
   * irisBaseline 학습(고정) 완료 여부.
   * 캘리브레이션 0번(중앙)점은 이 값이 false인 동안 baseline이 아직 수렴 중이므로
   * CalibrationOverlay가 distance/stability 게이트를 일시 면제하는 데 사용.
   */
  isBaselineLocked: boolean


  /**
   * 액션
   */
  /** 원본 시선 좌표를 갱신하고 confidence/lastUpdated를 함께 반영한다. */
  setRawGaze: (data: DetectedGazePoint | null) => void

  /** 필터링 완료된 시선 좌표를 갱신한다. */
  setFilteredGaze: (point: GazePoint | null) => void

  /** 보정 전(원본 필터링) 좌표를 갱신한다. 캘리브레이션 캡처용. */
  setUncalibratedGaze: (point: GazePoint | null) => void

  /** iris baseline 좌표(baselineX, baselineY)를 설정한다. */
  setBaselineCoords: (x: number, y: number) => void

  /** iris baseline 수렴(고정) 완료 여부를 설정한다. */
  setBaselineLocked: (locked: boolean) => void



  /** 시선 추적 진행 상태(isTracking)를 설정한다. */
  setIsTracking: (tracking: boolean) => void

  /** 얼굴 감지 여부를 설정하고, 감지 여부에 따라 confidence를 0 또는 1로 함께 갱신한다. */
  setFaceDetected: (detected: boolean) => void

  /** confidence 값을 직접 설정한다. */
  setConfidence: (confidence: number) => void

  /** stats.fps 값을 갱신한다. */
  setFPS: (fps: number) => void

  /** stats.stabilityScore 값을 갱신한다. */
  setStability: (value: number) => void

  /**
   * 다음/이전 페이지 드웰 진행률을 갱신한다.
   * prevPageZoneEnabled가 꺼져 있으면 prevProgress는 항상 0으로 강제된다.
   */
  setDwellProgress: (next: number, prev: number) => void

  /**
   * 다음/이전 페이지 네비게이션 트리거 플래그를 설정한다.
   * prevPageZoneEnabled가 꺼져 있으면 shouldNavigatePrev는 항상 false로 강제된다.
   */
  setNavigationTriggers: (next: boolean, prev: boolean) => void

  /** 현재 PDF 캔버스의 화면상 경계(bounds)를 설정한다. */
  setPdfBounds: (
    bounds: { x: number; y: number; width: number; height: number } | null,
  ) => void

  /** GazeCursor가 실제로 화면에 그리는 최종 위치를 기록한다(디버깅/분석용). */
  setCursorDisplayPos: (point: GazePoint | null, isClamped?: boolean) => void

  /**
   * 페이지 이동 직후 인지적 휴지기를 설정한다.
   * @param durationMs 현재 시각으로부터 이 기간(ms) 동안 커서를 화면 중앙으로 리셋
   */
  setNavigationPause: (durationMs: number) => void

  /** baselineResetTrigger를 1 증가시켜 Worker에 RESET_BASELINE 전송을 유도한다. */
  triggerBaselineReset: () => void

  /** 카메라 스트림 준비 완료 여부를 설정한다. */
  setCameraReady: (ready: boolean) => void

  /** 카메라 해상도 문자열을 설정한다. */
  setCameraResolution: (resolution: string | null) => void

  /** 감지된 얼굴 랜드마크 개수를 설정한다. */
  setLandmarkCount: (count: number) => void

  /**
   * 시선 추적 활성화 여부 (세션 상태, 뷰어 메뉴 토글용)
   */
  trackingEnabled: boolean
  setTrackingEnabled: (enabled: boolean) => void

  /**
   * 드웰(응시) 기준 시간(ms) — 설정 페이지 "넘김 딜레이" 슬라이더와 연동.
   * 변경 시 GazeRuntime이 Worker에 SET_DWELL_THRESHOLD 전송.
   */
  dwellThresholdMs: number
  setDwellThresholdMs: (ms: number) => void

  /**
   * 페이지 넘김 방식 — 설정 페이지 "넘김 방식" 세그먼트와 연동.
   * 'auto': 시선 핫존 자동 넘김만 / 'manual': 하단 바 터치 넘김만 / 'both': 둘 다.
   */
  turnMode: 'auto' | 'manual' | 'both'
  setTurnMode: (mode: 'auto' | 'manual' | 'both') => void

  /** 머리 자세(yaw/pitch/roll) 추정값을 설정한다. */
  setHeadPose: (
    pose: { yaw: number; pitch: number; roll: number } | null,
  ) => void

  /** 추적 통계(stats)의 일부 필드를 부분 갱신한다. */
  updateStats: (stats: Partial<TrackingStats>) => void

  /** 모든 상태를 초기 상태로 되돌린다. */
  reset: () => void
}

/**
 * 설정 페이지(SettingsLayout)에서 저장한 "넘김 딜레이"(ms) 값을 초기 상태에 반영.
 * 기본값: 800ms (Worker 기본 드웰 시간과 일치)
 */
const DEFAULT_DWELL_THRESHOLD_MS = 800

/**
 * localStorage에 저장된 드웰(응시) 임계값(ms)을 읽어온다.
 * 값이 없거나 유효하지 않으면 기본값(DEFAULT_DWELL_THRESHOLD_MS)을 반환한다.
 *
 * @returns 드웰 임계값(ms)
 */
function readStoredDwellThresholdMs(): number {
  try {
    const raw = localStorage.getItem('settings_turn_delay')
    if (raw === null) return DEFAULT_DWELL_THRESHOLD_MS
    const ms = JSON.parse(raw)
    return typeof ms === 'number' && ms > 0 ? ms : DEFAULT_DWELL_THRESHOLD_MS
  } catch {
    return DEFAULT_DWELL_THRESHOLD_MS
  }
}

/**
 * 설정 페이지(SettingsLayout)에서 저장한 "넘김 방식" 값을 초기 상태에 반영.
 * 기본값: 'auto' (SettingsLayout 기본값과 일치)
 *
 * @returns localStorage에 저장된 넘김 방식, 없거나 유효하지 않으면 'auto'
 */
function readStoredTurnMode(): 'auto' | 'manual' | 'both' {
  try {
    const raw = localStorage.getItem('settings_turn_mode')
    if (raw === null) return 'auto'
    const mode = JSON.parse(raw)
    return mode === 'auto' || mode === 'manual' || mode === 'both' ? mode : 'auto'
  } catch {
    return 'auto'
  }
}

// export interface GazeActions {
//   setRawGaze: (point: GazePoint) => void
//   setFilteredGaze: (point: GazePoint) => void
//   setIsTracking: (tracking: boolean) => void
//   setFPS: (fps: number) => void
//   setConfidence: (confidence: number) => void
//   reset: () => void
// }

// export type GazeStore = GazeState & GazeActions

/**
 * 초기 상태
 */
const initialState: Omit<
  GazeState,
  | 'setRawGaze'
  | 'setFilteredGaze'
  | 'setUncalibratedGaze'
  | 'setBaselineCoords'
  | 'setBaselineLocked'
  | 'setIsTracking'

  | 'setFaceDetected'
  | 'setConfidence'
  | 'setFPS'
  | 'setStability'
  | 'setDwellProgress'
  | 'setNavigationTriggers'
  | 'setPdfBounds'
  | 'setCursorDisplayPos'
  | 'setNavigationPause'
  | 'triggerBaselineReset'
  | 'setCameraReady'
  | 'setCameraResolution'
  | 'setLandmarkCount'
  | 'setHeadPose'
  | 'updateStats'
  | 'reset'
  | 'setTrackingEnabled'
  | 'setDwellThresholdMs'
  | 'setTurnMode'
> = {
  rawGaze: null,
  filteredGaze: null,
  uncalibratedGaze: null,
  baselineX: 0.5,
  baselineY: 0.5,
  isBaselineLocked: false,



  isTracking: false,
  isFaceDetected: false,

  confidence: 0,

  shouldNavigateNext: false,
  shouldNavigatePrev: false,
  nextProgress: 0,
  prevProgress: 0,
  pdfBounds: null,
  cursorDisplayPos: null,
  isCursorClamped: false,
  navigationPauseUntil: null,
  baselineResetTrigger: 0,

  cameraReady: false,
  cameraResolution: null,
  landmarkCount: 0,
  headPose: null,
  trackingEnabled: true,
  dwellThresholdMs: readStoredDwellThresholdMs(),
  turnMode: readStoredTurnMode(),

  stats: {
    fps: 0,
    latency: 0,
    frameCount: 0,
    stabilityScore: 0,
    predictionLatency: 0,
  },

  lastUpdated: null,
}

/**
 * Store
 */
/**
 * 시선 추적 상태(원본/필터링/보정 좌표, 추적 상태, 통계, 네비게이션 트리거 등)를
 * 관리하는 Zustand 스토어. subscribeWithSelector 미들웨어로 세분화된 구독을 지원한다.
 */
export const useGazeStore = create<GazeState>()(
  subscribeWithSelector((set) => ({
    ...initialState,

    /**
     * Raw gaze 저장
     *
     * 매우 빈번하게 호출됨
     * 최소 상태만 갱신
     */
    setRawGaze: (data) =>
      set(() => ({
        rawGaze: data,
        confidence: data?.confidence ?? 0,
        lastUpdated: Date.now(),
      })),

    /**
     * 필터링 완료 좌표 저장
     *
     * 실제 UI는 이 값 사용 권장
     */
    setFilteredGaze: (point) =>
      set(() => ({
        filteredGaze: point,
        lastUpdated: Date.now(),
      })),

    /**
     * 보정 전 좌표 저장 (캘리브레이션 캡처용)
     */
    setUncalibratedGaze: (point) =>
      set(() => ({
        uncalibratedGaze: point,
      })),

    /**
     * iris baseline 좌표 갱신
     */
    setBaselineCoords: (x, y) =>
      set(() => ({
        baselineX: x,
        baselineY: y,
      })),

    /**
     * iris baseline 수렴 완료 플래그 설정
     */
    setBaselineLocked: (locked) =>
      set(() => ({
        isBaselineLocked: locked,
      })),



    /**
     * 추적 시작/중지
     */
    setIsTracking: (tracking) =>
      set(() => ({
        isTracking: tracking,
      })),

    /**
     * 얼굴 감지 여부
     */
    setFaceDetected: (detected) =>
      set(() => ({
        isFaceDetected: detected,
        confidence: detected ? 1.0 : 0.0,
      })),

    /**
     * confidence 직접 갱신
     */
    setConfidence: (confidence) =>
      set(() => ({
        confidence,
      })),

    setFPS: (fps) =>
      set((state) => ({
        stats: {
          ...state.stats,
          fps,
        },
      })),

    setStability: (value) =>
      set((state) => ({
        stats: {
          ...state.stats,
          stabilityScore: value,
        },
      })),

    // prevPageZoneEnabled가 꺼져 있으면 이전 페이지 진행률은 항상 0으로 강제
    setDwellProgress: (next, prev) =>
      set(() => {
        const prevPageZoneEnabled = useDebugStore.getState().prevPageZoneEnabled
        /*
        console.log('[gazeStore] setDwellProgress:', {
          next,
          prev,
          prevPageZoneEnabled,
        })
        */
        return {
          nextProgress: next,
          prevProgress: prevPageZoneEnabled ? prev : 0,
        }
      }),

    // prevPageZoneEnabled가 꺼져 있으면 이전 페이지 트리거는 항상 false로 강제
    setNavigationTriggers: (next, prev) =>
      set(() => {
        const prevPageZoneEnabled = useDebugStore.getState().prevPageZoneEnabled
        /*
        console.log('[gazeStore] setNavigationTriggers:', {
          next,
          prev,
          prevPageZoneEnabled,
        })
        */
        return {
          shouldNavigateNext: next,
          shouldNavigatePrev: prevPageZoneEnabled ? prev : false,
        }
      }),

    /**
     * PDF 캔버스의 화면상 경계 저장
     */
    setPdfBounds: (bounds) =>
      set(() => ({
        pdfBounds: bounds,
      })),

    /**
     * GazeCursor 최종 표시 위치 기록
     */
    setCursorDisplayPos: (point, isClamped = false) =>
      set(() => ({
        cursorDisplayPos: point,
        isCursorClamped: isClamped,
      })),

    /**
     * 인지적 휴지기 종료 시각 설정 (현재 시각 + durationMs)
     */
    setNavigationPause: (durationMs) =>
      set(() => ({
        navigationPauseUntil: Date.now() + durationMs,
      })),

    /**
     * baseline 리셋 트리거 카운터 증가
     */
    triggerBaselineReset: () =>
      set((state) => ({
        baselineResetTrigger: state.baselineResetTrigger + 1,
      })),

    /**
     * 카메라 준비 상태 설정
     */
    setCameraReady: (ready) =>
      set(() => ({
        cameraReady: ready,
      })),

    /**
     * 카메라 해상도 설정
     */
    setCameraResolution: (resolution) =>
      set(() => ({
        cameraResolution: resolution,
      })),

    /**
     * 감지된 랜드마크 개수 설정
     */
    setLandmarkCount: (count) =>
      set(() => ({
        landmarkCount: count,
      })),

    /**
     * 머리 자세 추정값 설정
     */
    setHeadPose: (pose) =>
      set(() => ({
        headPose: pose,
      })),

    /**
     * 성능 통계 업데이트
     */
    updateStats: (stats) =>
      set((state) => ({
        stats: {
          ...state.stats,
          ...stats,
        },
      })),

    /**
     * 시선 추적 활성화 여부 설정 (세션 상태 토글)
     */
    setTrackingEnabled: (enabled) =>
      set(() => ({
        trackingEnabled: enabled,
      })),

    /**
     * 드웰 기준 시간(ms) 설정
     */
    setDwellThresholdMs: (ms) =>
      set(() => ({
        dwellThresholdMs: ms,
      })),

    /**
     * 페이지 넘김 방식 설정
     */
    setTurnMode: (mode) =>
      set(() => ({
        turnMode: mode,
      })),

    /**
     * 전체 초기화
     */
    reset: () => set(() => ({ ...initialState })),
  })),
)
