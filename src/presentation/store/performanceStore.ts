// src/presentation/store/performanceStore.ts
// "연주 시작" 기능 상태 — 메트로놈 BPM, 시작 딜레이, 설정/카운트다운/연주 진행 단계.
//
// 흐름:
//   HomeLayout "연주 시작" 클릭 → openSetup() → PerformanceSetupOverlay 표시
//   → 사용자가 BPM/딜레이 설정 후 확정 → confirmSetupAndStart()
//     (isSetupOpen=false, isCountdownPending=true) → 뷰어로 navigate
//   → UserViewerLayout 진입 시 isCountdownPending=true면 PerformanceCountdownOverlay 표시
//   → 카운트다운 끝나거나 터치로 스킵 → skipOrFinishCountdown()
//     (isCountdownPending=false, isPerformanceActive=true)
//   → PerformanceGridOverlay가 BPM에 맞춰 6x4 그리드를 순서대로 강조
//   → stopPerformance()로 언제든 중단 가능

import { create } from 'zustand'

export const BPM_PRESETS = [60, 80, 100, 120, 140] as const
export const DELAY_PRESETS = [3, 5, 10] as const

export const MIN_BPM = 20
export const MAX_BPM = 240

export const MIN_DELAY_SECONDS = 0
export const MAX_DELAY_SECONDS = 30

export const GRID_ROWS = 6
export const GRID_COLS = 4

/**
 * "연주 시작" 기능(메트로놈 기반 그리드 하이라이트)의 상태와 액션을 정의하는 인터페이스.
 */
export interface PerformanceState {
  /** 메트로놈 BPM(분당 비트 수) */
  bpm: number
  /** 연주 시작 전 카운트다운 지연(초) */
  delaySeconds: number

  /** 설정 오버레이(PerformanceSetupOverlay) 표시 여부 */
  isSetupOpen: boolean
  /** 카운트다운 대기 중 여부 */
  isCountdownPending: boolean
  /** 그리드 하이라이트 연주 진행 중 여부 */
  isPerformanceActive: boolean

  /** BPM을 설정한다. MIN_BPM~MAX_BPM 범위로 clamp된다. */
  setBpm: (bpm: number) => void
  /** 시작 딜레이(초)를 설정한다. MIN_DELAY_SECONDS~MAX_DELAY_SECONDS 범위로 clamp된다. */
  setDelaySeconds: (seconds: number) => void

  /** 설정 오버레이를 연다. */
  openSetup: () => void
  /** 설정 오버레이를 닫는다. */
  closeSetup: () => void

  /** 설정 확정 — 설정창 닫고 뷰어 진입 시 카운트다운을 띄우도록 표시 */
  confirmSetupAndStart: () => void

  /** 카운트다운 종료(시간 만료 또는 터치 스킵) → 연주(그리드 하이라이트) 시작 */
  skipOrFinishCountdown: () => void

  /** 연주 중단 — 그리드 하이라이트 정지 */
  stopPerformance: () => void
}

/**
 * 값을 [min, max] 범위로 제한한다.
 * @param value 입력 값
 * @param min 최소값
 * @param max 최대값
 * @returns min과 max 사이로 clamp된 값
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * "연주 시작" 기능(메트로놈 BPM, 카운트다운, 그리드 하이라이트 진행 단계)의
 * 상태를 관리하는 Zustand 스토어.
 */
export const usePerformanceStore = create<PerformanceState>((set) => ({
  bpm: 100,
  delaySeconds: 3,

  isSetupOpen: false,
  isCountdownPending: false,
  isPerformanceActive: false,

  setBpm: (bpm) => {
    if (!Number.isFinite(bpm)) return
    set({ bpm: clamp(Math.round(bpm), MIN_BPM, MAX_BPM) })
  },

  setDelaySeconds: (seconds) => {
    if (!Number.isFinite(seconds)) return
    set({ delaySeconds: clamp(Math.round(seconds), MIN_DELAY_SECONDS, MAX_DELAY_SECONDS) })
  },

  openSetup: () => set({ isSetupOpen: true }),
  closeSetup: () => set({ isSetupOpen: false }),

  confirmSetupAndStart: () => {
    set({
      isSetupOpen: false,
      isCountdownPending: true,
      isPerformanceActive: false,
    })
  },

  skipOrFinishCountdown: () => {
    set({ isCountdownPending: false, isPerformanceActive: true })
  },

  stopPerformance: () => {
    set({ isPerformanceActive: false, isCountdownPending: false })
  },
}))
