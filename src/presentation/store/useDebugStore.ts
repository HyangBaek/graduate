// src/presentation/store/useDebugStore.ts

import { create } from 'zustand'

/**
 * 디버그 패널/오버레이에서 사용하는 표시 옵션과 실시간 디버깅 데이터를
 * 관리하는 상태 인터페이스.
 */
export interface DebugState {
  /** 디버그 패널 표시 여부 */
  isVisible: boolean
  /** 샌드박스 모드 활성화 여부 */
  sandboxEnabled: boolean
  /** 시선 커서 표시 여부 */
  cursorVisible: boolean
  /** 커서 디버그 정보(좌표 등) 표시 여부 */
  cursorDebugVisible: boolean
  /** 이전 페이지 핫존 활성화 여부 */
  prevPageZoneEnabled: boolean
  /** 현재 추적 FPS */
  fps: number
  /** 얼굴 감지 여부 */
  isFaceDetected: boolean
  /** 캘리브레이션 오프셋 디버그 값 */
  calibrationOffset: number
  /** 드웰(응시) 진행률 */
  dwellProgress: number
  /** 마지막 페이지 네비게이션 트리거 종류 */
  pageNavigationTrigger: string
  /** 원본 시선 좌표 */
  rawGaze: { x: number; y: number }
  /** 필터링된 시선 좌표 */
  filteredGaze: { x: number; y: number }
  /** 디버그 패널 표시 여부를 토글한다. */
  toggleVisibility: () => void
  /** 샌드박스 모드 활성화 여부를 설정한다. */
  setSandboxEnabled: (enabled: boolean) => void
  /** 시선 커서 표시 여부를 설정한다. */
  setCursorVisible: (visible: boolean) => void
  /** 커서 디버그 정보 표시 여부를 설정한다. */
  setCursorDebugVisible: (visible: boolean) => void
  /** 이전 페이지 핫존 활성화 여부를 설정한다. */
  setPrevPageZoneEnabled: (enabled: boolean) => void
  /**
   * 여러 디버그 데이터 필드를 한 번에 부분 갱신한다.
   * @param data 갱신할 디버그 상태의 일부 (액션 함수 필드는 제외)
   */
  setDebugData: (
    data: Partial<
      Omit<
        DebugState,
        | 'toggleVisibility'
        | 'setDebugData'
        | 'setSandboxEnabled'
        | 'setCursorVisible'
        | 'setCursorDebugVisible'
        | 'setPrevPageZoneEnabled'
      >
    >,
  ) => void
}

/**
 * 디버그 패널/오버레이의 표시 옵션과 실시간 추적 디버그 데이터를 관리하는 Zustand 스토어.
 */
export const useDebugStore = create<DebugState>((set) => ({
  isVisible: true,
  sandboxEnabled: false,
  cursorVisible: true,
  cursorDebugVisible: true,
  prevPageZoneEnabled: false,  // 사용자 모드 기본값: 비활성. 토글로 활성화 가능.
  fps: 0,
  isFaceDetected: false,
  calibrationOffset: 0,
  dwellProgress: 0,
  pageNavigationTrigger: 'NONE',
  rawGaze: { x: 0, y: 0 },
  filteredGaze: { x: 0, y: 0 },
  toggleVisibility: () => set((state) => ({ isVisible: !state.isVisible })),
  setSandboxEnabled: (enabled) => set(() => ({ sandboxEnabled: enabled })),
  setCursorVisible: (visible) => set(() => ({ cursorVisible: visible })),
  setCursorDebugVisible: (visible) =>
    set(() => ({ cursorDebugVisible: visible })),
  setPrevPageZoneEnabled: (enabled) =>
    set(() => ({ prevPageZoneEnabled: enabled })),
  setDebugData: (data) => set((state) => ({ ...state, ...data })),
}))
