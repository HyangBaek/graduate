// src/presentation/state/calibrationStore.ts

import { create } from 'zustand'
import {
  persist,
  createJSONStorage,
  subscribeWithSelector,
} from 'zustand/middleware'

import type { CalibrationData } from '@domain/models/CalibrationData'
import type { CalibrationSample } from '@domain/models/CalibrationSample'
import { CALIBRATION_POINTS } from '../constants/calibrationPoints'

/*
 * calibration point 기본 개수
 *
 * 3x3 grid 기준
 */
const DEFAULT_TOTAL_POINTS = CALIBRATION_POINTS.length

/*
 * calibration 최대 sample 제한
 *
 * 메모리 증가 방지
 */
const MAX_SAMPLES = 500

/**
 * 캘리브레이션(시선 보정) 진행 상태와 결과, 그리고 관련 액션을 정의하는 상태 인터페이스.
 */
export interface CalibrationState {
  /*
   * hydration 완료 여부
   *
   * persist 복원 완료 플래그
   */
  isHydrated: boolean

  /*
   * calibration 진행 중 여부
   */
  isCalibrating: boolean

  /*
   * calibration 완료 여부
   */
  isCalibrated: boolean

  /*
   * 현재 calibration point index
   */
  currentPointIndex: number

  /*
   * 전체 calibration point 개수
   */
  totalPoints: number

  /*
   * calibration 중 수집된 sample
   */
  samples: CalibrationSample[]

  /*
   * 최종 calibration 결과
   */
  calibrationData: CalibrationData | null

  /*
   * calibration 품질 점수
   */
  qualityScore: number

  /*
   * 마지막 calibration 시각
   */
  lastCalibratedAt: number | null

  /*
   * calibration 에러 메시지
   */
  error: string | null

  /*
   * 자동 캘리브레이션을 거부/취소했는지 여부
   */
  hasDeclinedAutoCalibration: boolean

  /*
   * GazeCursor 표시 여부 (설정 토글)
   * viewer 라우트에서만 적용. home/settings에서는 항상 숨김
   */
  gazeCursorEnabled: boolean
  setGazeCursorEnabled: (enabled: boolean) => void


  /*
   * calibration 시작
   */
  /** 캘리브레이션을 시작하고 진행 관련 상태를 초기화한다. */
  startCalibration: () => void

  /*
   * calibration 완료
   */
  /**
   * 캘리브레이션을 완료 처리하고 결과 데이터를 저장한다.
   * @param calibrationData 캘리브레이션 결과(오프셋, 스케일, 품질 점수 등)
   */
  finishCalibration: (
    calibrationData: CalibrationData
  ) => void

  /*
   * calibration 취소
   */
  /** 진행 중인 캘리브레이션을 취소하고 자동 캘리브레이션 거부 상태로 표시한다. */
  cancelCalibration: () => void

  /*
   * calibration sample 추가
   */
  /**
   * 캘리브레이션 샘플을 추가한다. MAX_SAMPLES를 초과하면 가장 오래된 샘플을 제거한다.
   * @param sample 추가할 캘리브레이션 샘플
   */
  addSample: (
    sample: CalibrationSample
  ) => void

  /*
   * 다음 calibration point 이동
   */
  /** 다음 캘리브레이션 포인트로 이동한다. 마지막 포인트를 초과하면 동작하지 않는다. */
  nextPoint: () => void

  /*
   * calibration 초기화
   */
  /** 캘리브레이션 상태를 초기값으로 되돌린다(hydration 플래그는 유지). */
  resetCalibration: () => void

  /*
   * calibration 결과 제거
   */
  /** 저장된 캘리브레이션 결과(완료 여부, 데이터, 품질 점수 등)를 제거한다. */
  clearCalibrationData: () => void

  /*
   * calibration 에러 설정
   */
  /**
   * 캘리브레이션 에러 메시지를 설정한다.
   * @param error 에러 메시지, 없으면 null
   */
  setError: (
    error: string | null
  ) => void

  /*
   * calibration point 개수 설정
   */
  /**
   * 전체 캘리브레이션 포인트 개수를 설정한다.
   * @param totalPoints 전체 포인트 개수
   */
  setTotalPoints: (
    totalPoints: number
  ) => void
}

const initialState = {
  isHydrated: false,

  isCalibrating: false,

  isCalibrated: false,

  currentPointIndex: 0,

  totalPoints: DEFAULT_TOTAL_POINTS,

  samples: [],

  calibrationData: null,

  qualityScore: 0,

  lastCalibratedAt: null,

  error: null,
  hasDeclinedAutoCalibration: false,
  gazeCursorEnabled: true,
}

/**
 * 캘리브레이션 진행 상태와 결과를 관리하는 Zustand 스토어.
 * subscribeWithSelector로 세분화된 구독을 지원하고, persist 미들웨어로
 * 캘리브레이션 결과를 localStorage에 영속화한다.
 */
export const useCalibrationStore =
  create<CalibrationState>()(
    subscribeWithSelector(
      persist(
        (set, get) => ({
        ...initialState,

        /*
         * calibration 시작
         */
        startCalibration: () => {
          set({
            isCalibrating: true,

            isCalibrated: false,

            currentPointIndex: 0,

            samples: [],

            qualityScore: 0,

            error: null,

            hasDeclinedAutoCalibration: false,

            calibrationData: null,
          })
        },

        /*
         * calibration 완료
         */
        finishCalibration: (
          calibrationData
        ) => {
          set({
            isCalibrating: false,

            isCalibrated: true,

            calibrationData,

            qualityScore:
              calibrationData.qualityScore,

            lastCalibratedAt:
              calibrationData.calibratedAt,

            error: null,
          })
        },

        /*
         * calibration 취소
         */
        cancelCalibration: () => {
          set({
            isCalibrating: false,

            currentPointIndex: 0,

            samples: [],

            error: null,

            hasDeclinedAutoCalibration: true,
          })
        },

        /*
         * calibration sample 추가
         */
        // 최대 샘플 수(MAX_SAMPLES) 도달 시 가장 오래된 샘플(맨 앞)을 제거하고 새 샘플을 추가
        addSample: (sample) => {
          set((state) => {
            /*
             * sample 개수 제한
             *
             * 오래된 sample 제거
             */
            const nextSamples =
              state.samples.length >=
              MAX_SAMPLES
                ? [
                    ...state.samples.slice(1),
                    sample,
                  ]
                : [
                    ...state.samples,
                    sample,
                  ]

            return {
              samples: nextSamples,
            }
          })
        },

        /*
         * calibration point 증가
         */
        nextPoint: () => {
          const {
            currentPointIndex,
            totalPoints,
          } = get()

          /*
           * 마지막 point 초과 방지
           */
          if (
            currentPointIndex >=
            totalPoints - 1
          ) {
            return
          }

          set({
            currentPointIndex:
              currentPointIndex + 1,
          })
        },

        /*
         * calibration 전체 초기화
         */
        resetCalibration: () => {
          set({
            ...initialState,

            /*
             * hydration 유지
             */
            isHydrated: true,

            hasDeclinedAutoCalibration: false,
          })
        },

        setGazeCursorEnabled: (enabled) => set({ gazeCursorEnabled: enabled }),

        /*
         * calibration 결과 제거
         */
        clearCalibrationData: () => {
          set({
            isCalibrated: false,

            calibrationData: null,

            qualityScore: 0,

            lastCalibratedAt: null,
          })
        },

        /*
         * error 설정
         */
        setError: (error) => {
          set({
            error,
          })
        },

        /*
         * calibration point 개수 설정
         */
        setTotalPoints: (
          totalPoints
        ) => {
          set({
            totalPoints,
          })
        },
      }),

      {
        /*
         * localStorage key
         */
        name:
          'web-eye-track-calibration',

        /*
         * storage
         */
        storage: createJSONStorage(
          () => localStorage
        ),

        /*
         * persist 대상 제한
         *
         * runtime 데이터 제외
         */
        partialize: (state) => ({
          isCalibrated:
            state.isCalibrated,

          calibrationData:
            state.calibrationData,

          qualityScore:
            state.qualityScore,

          lastCalibratedAt:
            state.lastCalibratedAt,

          totalPoints:
            state.totalPoints,

          hasDeclinedAutoCalibration:
            state.hasDeclinedAutoCalibration,
          gazeCursorEnabled:
            state.gazeCursorEnabled,
        }),

        /*
         * persist schema version
         *
         * v1 → v2: irisBaseline 자동 중심 보정 도입 → 재캘리브레이션 필요
         * v2 → v3: tanh GAIN 변경 (GAIN_X 15→25, GAIN_Y 20→32) + 동적 GAIN 도입
         *   기존 calibration은 구 GAIN 기준 pixel range로 계산되어 맞지 않음
         *   → 재캘리브레이션 필요
         * v4 → v5: 13점 캘리브레이션 (초기 Center 학습 추가) → 기존 9점/12점 데이터 삭제 및 리셋
         */
        version: 6,

        /**
         * persist 스키마 마이그레이션 핸들러.
         * version 6 미만의 영속 상태는 캘리브레이션 데이터를 모두 초기화해
         * 사용자가 재캘리브레이션하도록 강제한다(GAIN/포인트 구조 변경 등 호환성 문제 방지).
         * @param persistedState localStorage에서 복원된 이전 상태
         * @param version 복원된 상태의 persist 버전
         * @returns 마이그레이션된 상태
         */
        migrate: (persistedState: unknown, version: number) => {
          const state = persistedState as Record<string, unknown>
          if (version < 6) {
            return {
              ...state,
              calibrationData: null,
              isCalibrated: false,
              qualityScore: 0,
              lastCalibratedAt: null,
              totalPoints: CALIBRATION_POINTS.length,
            }
          }
          return state
        },

        /*
         * hydration 완료 처리
         */
        /**
         * persist 스토리지로부터 hydration이 끝난 후 호출되는 콜백.
         * 진행 중 플래그를 리셋하고 totalPoints를 최신 캘리브레이션 포인트 개수로 동기화한다.
         */
        onRehydrateStorage:
          () => (state) => {
            if (!state) {
              return
            }

            state.isHydrated = true
            // 앱 재시작 시 항상 캘리브레이션 진행 상태를 초기화
            // (이전 세션에서 isCalibrating=true로 종료된 경우 커서가 숨겨지는 버그 방지)
            state.isCalibrating = false
            // hydration 완료 후, totalPoints를 최신 하드코딩된 개수로 강제 설정
            state.totalPoints = CALIBRATION_POINTS.length
          },
      }
    ))
  )