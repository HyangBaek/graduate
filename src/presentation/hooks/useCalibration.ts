// src/presentation/hooks/useCalibration.ts
//
// ── 최적화 ──────────────────────────────────────────────────────────────────
//  state 4개 개별 구독 → useShallow 단일 구독 (4개 → 1개 구독)
//  action 6개 개별 구독 → getState() 직접 접근으로 교체
//    Zustand action은 stable reference → 구독 불필요, deps 불필요
//
//  결과: useCalibration 호출 컴포넌트의 불필요 리렌더 감소

import { useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { RunCalibrationUseCase } from '@domain/usecases/RunCalibrationUseCase'
import { CalibrationService } from '@domain/services/CalibrationService'
import { RlsFilter } from '@domain/services/RlsFilter'
import type { GazePoint } from '@domain/models/GazePoint'
import type { CalibrationSample } from '@domain/models/CalibrationSample'
import { useCalibrationStore } from '@/presentation/store/calibrationStore'
import { useGazeStore } from '@/presentation/state/gazeStore'
import { useAppRouter } from '@/app/router/useAppRouter'
import { calibrationLogger } from '@/infrastructure/storage/CalibrationLoggerImpl'
import { CALIBRATION_POINTS } from '@/presentation/constants/calibrationPoints'

const calibrationService =
  new CalibrationService()

const runCalibrationUseCase =
  new RunCalibrationUseCase(calibrationService)

// RLS filters for real-time weights adjustment
const rlsX = new RlsFilter()
const rlsY = new RlsFilter()

/**
 * 시선 캘리브레이션 흐름(시작/취소/리셋/샘플 캡처/다음 점 이동/완료)을
 * 제어하는 훅. calibrationStore의 상태를 구독하고, RLS 필터를 이용해
 * 샘플이 들어올 때마다 실시간으로 보정 계수를 갱신하며, calibrationLogger를
 * 통해 분석용 로그도 함께 기록한다. UserViewerLayout과 DebugDrawer에서
 * 공용으로 사용된다.
 *
 * @returns isCalibrating, isCalibrated, currentPointIndex, samples 상태와
 *          startCalibration/cancelCalibration/resetCalibration/captureSample/
 *          moveNextPoint/completeCalibration 액션 함수들을 담은 객체
 */
export const useCalibration = () => {
  // ── state — useShallow로 단일 구독 통합 (4개 → 1개) ──────────────────────
  const { isCalibrating, isCalibrated, currentPointIndex, samples } =
    useCalibrationStore(
      useShallow((s) => ({
        isCalibrating: s.isCalibrating,
        isCalibrated: s.isCalibrated,
        currentPointIndex: s.currentPointIndex,
        samples: s.samples,
      }))
    )

  // ── actions — getState() 직접 접근 (구독 6개 제거) ────────────────────────
  // Zustand action은 store 생성 시 1회 생성되는 stable reference.
  // 구독하지 않아도 최신 함수를 참조하므로 안전.

  const startCalibration = useCallback(() => {
    rlsX.reset()
    rlsY.reset()
    useCalibrationStore.getState().startCalibration()
    useGazeStore.getState().triggerBaselineReset()
    // 캘리브레이션 문제 분석용 로그 세션 시작 (이전 캘리브레이션과 비교 분석 가능하게)
    // 이 훅은 UserViewerLayout(실제 읽기 화면)과 DebugDrawer(디버그 화면)에서
    // 공용으로 쓰이므로, 호출 시점의 라우트로 source를 구분한다.
    const isDebugRoute = useAppRouter.getState().currentPage === 'debug'
    calibrationLogger.startSession({
      total_points: CALIBRATION_POINTS.length,
      screen_width: window.innerWidth,
      screen_height: window.innerHeight,
      device_pixel_ratio: window.devicePixelRatio,
      source: isDebugRoute ? 'debug' : 'user',
    })
  }, [])

  const cancelCalibration = useCallback(() => {
    useCalibrationStore.getState().cancelCalibration()
    calibrationLogger.cancelSession()
  }, [])

  const resetCalibration = useCallback(() => {
    useCalibrationStore.getState().resetCalibration()
  }, [])

  /**
   * 캘리브레이션 점 하나에 대한 시선 샘플을 기록하고, RLS 필터로 실시간
   * 보정 계수를 갱신한다.
   * @param targetX 캘리브레이션 점의 화면 x 좌표
   * @param targetY 캘리브레이션 점의 화면 y 좌표
   * @param gaze 해당 시점에 측정된 시선 좌표
   * @param weight 샘플 가중치(선택)
   */
  const captureSample = useCallback(
    (targetX: number, targetY: number, gaze: GazePoint, weight?: number) => {
      const sample: CalibrationSample = { targetX, targetY, gaze, weight }
      useCalibrationStore.getState().addSample(sample)

      // captureSample은 CalibrationOverlay의 rAF dwell 루프 안에서 호출되는데, 이전에는
      // 아래 RLS 갱신이 try/catch 바깥에 있어 예외가 나면 그대로 호출자(루프)까지 전파되어
      // moveNextPoint()가 실행되지 못하고 루프 자체가 멈춰버리는("게이지 다 찼는데 안 넘어감")
      // 문제가 있었음. RLS 갱신부터 store 반영까지 전체를 try/catch로 감싸 어떤 예외가
      // 나도 captureSample이 정상 반환되어 다음 점으로 전환이 항상 진행되도록 한다.
      try {
        // 1. Update RLS models incrementally (using normalized coords for numerical stability)
        const W = window.innerWidth
        const H = window.innerHeight
        rlsX.update(gaze.x / W, gaze.y / H, targetX / W, false)
        rlsY.update(gaze.x / W, gaze.y / H, targetY / H, true)

        // 2. Instantly update store with intermediate RLS coefficients
        const latestSamples = useCalibrationStore.getState().samples
        const { baselineX, baselineY } = useGazeStore.getState()

        // 3x3 local Grid offsets are computed once we have at least 4 samples
        let gridOffsets: { offsetX: number; offsetY: number }[][] | undefined = undefined
        if (latestSamples.length >= 4) {
          const intermediateData = calibrationService.calculate(latestSamples)
          gridOffsets = intermediateData.gridOffsets
        }

        const updatedData = {
          offsetX: 0,
          offsetY: 0,
          scaleX: 1,
          scaleY: 1,
          polyCoeffsX: rlsX.getWeights(),
          polyCoeffsY: rlsY.getWeights(),
          gridOffsets,
          qualityScore: 100,
          screenWidth: window.innerWidth,
          screenHeight: window.innerHeight,
          calibratedAt: Date.now(),
          devicePixelRatio: window.devicePixelRatio,
          baselineX,
          baselineY,
        }

        useCalibrationStore.setState({ calibrationData: updatedData })
        console.log('[useCalibration] 🎯 RLS 실시간 점진 보정 반영:', updatedData)
      } catch (e) {
        console.warn('[useCalibration] RLS 실시간 보정 계산 실패 (다음 점 전환은 계속 진행):', e)
      }
    },
    []
  )

  const moveNextPoint = useCallback(() => {
    useCalibrationStore.getState().nextPoint()
  }, [])

  const completeCalibration = useCallback(() => {
    const latestSamples = useCalibrationStore.getState().samples
    if (latestSamples.length === 0) return

    const calibrationData = runCalibrationUseCase.execute(latestSamples)
    const { baselineX, baselineY } = useGazeStore.getState()
    const finalData = { ...calibrationData, baselineX, baselineY }

    useCalibrationStore.getState().finishCalibration(finalData)
    calibrationLogger.endSession(calibrationData.qualityScore)
  }, [])

  return {
    isCalibrating,
    isCalibrated,
    currentPointIndex,
    samples,
    startCalibration,
    cancelCalibration,
    resetCalibration,
    captureSample,
    moveNextPoint,
    completeCalibration,
  }
}
