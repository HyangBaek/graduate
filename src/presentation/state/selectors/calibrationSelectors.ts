// src/presentation/state/selectors/calibrationSelectors.ts

import { useShallow } from 'zustand/shallow'
import { useCalibrationStore } from '@/presentation/store/calibrationStore'

/*
 * =========================================================
 * 기본 상태 selector
 * =========================================================
 */

/*
 * calibration 진행 여부
 */
/**
 * 현재 캘리브레이션이 진행 중인지 여부를 반환하는 selector.
 * @returns isCalibrating 값
 */
export const useIsCalibrating = () =>
  useCalibrationStore(
    (state) => state.isCalibrating
  )

/*
 * calibration 완료 여부
 */
/**
 * 캘리브레이션이 완료되었는지 여부를 반환하는 selector.
 * @returns isCalibrated 값
 */
export const useIsCalibrated = () =>
  useCalibrationStore(
    (state) => state.isCalibrated
  )

/*
 * 현재 calibration point index
 */
/**
 * 현재 진행 중인 캘리브레이션 포인트의 인덱스를 반환하는 selector.
 * @returns currentPointIndex 값
 */
export const useCalibrationPointIndex = () =>
  useCalibrationStore(
    (state) => state.currentPointIndex
  )

/*
 * calibration 품질 점수
 */
/**
 * 캘리브레이션 품질 점수를 반환하는 selector.
 * @returns qualityScore 값
 */
export const useCalibrationQualityScore =
  () =>
    useCalibrationStore(
      (state) => state.qualityScore
    )

/*
 * calibration 결과
 */
/**
 * 캘리브레이션 결과 데이터를 반환하는 selector.
 * @returns calibrationData 값
 */
export const useCalibrationData = () =>
  useCalibrationStore(
    (state) => state.calibrationData
  )

/*
 * calibration sample 목록
 */
/**
 * 캘리브레이션 중 수집된 샘플 목록을 반환하는 selector.
 * @returns samples 배열
 */
export const useCalibrationSamples = () =>
  useCalibrationStore(
    (state) => state.samples
  )

/*
 * 마지막 calibration 시간
 */
/**
 * 마지막으로 캘리브레이션이 완료된 시각을 반환하는 selector.
 * @returns lastCalibratedAt 값
 */
export const useLastCalibratedAt = () =>
  useCalibrationStore(
    (state) => state.lastCalibratedAt
  )

/*
 * =========================================================
 * 최적화 selector
 * =========================================================
 */

/*
 * calibration offset
 *
 * shallow 적용 이유:
 * 객체 반환 시
 * 매 렌더마다 객체 재생성 방지
 */
/**
 * 캘리브레이션 결과의 offsetX/offsetY를 묶어 반환하는 selector.
 * useShallow로 얕은 비교를 적용해 객체 재생성으로 인한 불필요한 재렌더를 방지한다.
 * @returns { offsetX, offsetY } 객체 (calibrationData 없으면 0)
 */
export const useCalibrationOffset = () =>
  useCalibrationStore(
    useShallow((state) => ({
      offsetX: state.calibrationData?.offsetX ?? 0,
      offsetY: state.calibrationData?.offsetY ?? 0,
    })),
  )

/*
 * calibration scale
 */
/**
 * 캘리브레이션 결과의 scaleX/scaleY를 묶어 반환하는 selector.
 * @returns { scaleX, scaleY } 객체 (calibrationData 없으면 1)
 */
export const useCalibrationScale = () =>
  useCalibrationStore(
    useShallow((state) => ({
      scaleX:
        state.calibrationData?.scaleX ?? 1,

      scaleY:
        state.calibrationData?.scaleY ?? 1,
    })),
  )

/*
 * calibration screen info
 */
/**
 * 캘리브레이션 시점의 화면 크기/DPR 정보를 묶어 반환하는 selector.
 * @returns { screenWidth, screenHeight, devicePixelRatio } 객체
 */
export const useCalibrationScreenInfo =
  () =>
    useCalibrationStore(
      useShallow((state) => ({
        screenWidth:
          state.calibrationData
            ?.screenWidth ?? 0,

        screenHeight:
          state.calibrationData
            ?.screenHeight ?? 0,

        devicePixelRatio:
          state.calibrationData
            ?.devicePixelRatio ?? 1,
    })),
  )

/*
 * calibration 상태 묶음
 *
 * calibration overlay 같은 UI에서 사용
 */
/**
 * 캘리브레이션 진행/완료/포인트 인덱스/품질 점수를 묶어 반환하는 selector.
 * CalibrationOverlay 등에서 단일 구독으로 여러 상태를 함께 사용할 때 쓴다.
 * @returns { isCalibrating, isCalibrated, currentPointIndex, qualityScore } 객체
 */
export const useCalibrationStatus =
  () =>
    useCalibrationStore(
      useShallow((state) => ({
        isCalibrating:
          state.isCalibrating,

        isCalibrated:
          state.isCalibrated,

        currentPointIndex:
          state.currentPointIndex,

        qualityScore:
          state.qualityScore,
    })),
  )

/*
 * =========================================================
 * action selector
 * =========================================================
 *
 * action selector 분리 이유:
 * component re-render 최소화
 */

/**
 * 캘리브레이션 관련 액션 함수들을 묶어 반환하는 selector.
 * 액션 함수는 참조가 안정적이므로 useShallow와 함께 사용해도 재렌더가 발생하지 않는다.
 * @returns startCalibration, finishCalibration, cancelCalibration, addSample,
 *          nextPoint, resetCalibration, clearCalibrationData 액션 묶음
 */
export const useCalibrationActions =
  () =>
    useCalibrationStore(
      useShallow((state) => ({
        startCalibration:
          state.startCalibration,

        finishCalibration:
          state.finishCalibration,

        cancelCalibration:
          state.cancelCalibration,

        addSample:
          state.addSample,

        nextPoint:
          state.nextPoint,

        resetCalibration:
          state.resetCalibration,

        clearCalibrationData:
          state.clearCalibrationData,
    })),
  )

/*
 * =========================================================
 * 실무용 derived selector
 * =========================================================
 */

/*
 * calibration 가능 여부
 *
 * 예:
 * calibration 중이면 false
 */
/**
 * 새로운 캘리브레이션을 시작할 수 있는지 여부를 반환하는 derived selector.
 * 이미 진행 중이면 false.
 * @returns 시작 가능 여부
 */
export const useCanStartCalibration =
  () =>
    useCalibrationStore(
      (state) =>
        !state.isCalibrating
    )

/*
 * calibration 유효 여부
 *
 * quality 기준 포함
 */
/**
 * 현재 캘리브레이션 결과가 유효한지(완료 + 품질 점수 0.6 이상) 여부를 반환하는 selector.
 * @returns 유효한 캘리브레이션 여부
 */
export const useHasValidCalibration =
  () =>
    useCalibrationStore((state) => {
      if (
        !state.isCalibrated ||
        !state.calibrationData
      ) {
        return false
      }

      return (
        state.qualityScore >= 0.6
      )
    })

/*
 * calibration 만료 여부
 *
 * 예:
 * 24시간 이후 재보정 요구
 */
/**
 * 마지막 캘리브레이션 시각으로부터 expireMs가 지났는지(만료 여부) 반환하는 selector.
 * @param expireMs 만료 기준 시간(ms), 기본값 24시간
 * @returns 만료 여부 (lastCalibratedAt이 없으면 true)
 */
export const useIsCalibrationExpired =
  (
    expireMs =
      1000 * 60 * 60 * 24
  ) =>
    useCalibrationStore((state) => {
      if (
        !state.lastCalibratedAt
      ) {
        return true
      }

      return (
        Date.now() -
          state.lastCalibratedAt >
        expireMs
      )
    })

/*
 * calibration 진행률
 *
 * totalPoints 기준 계산
 */
/**
 * 전체 포인트 수 대비 현재 진행률(0~1)을 반환하는 selector.
 * @param totalPoints 전체 캘리브레이션 포인트 개수
 * @returns 진행률 (totalPoints가 0 이하이면 0)
 */
export const useCalibrationProgress =
  (
    totalPoints: number
  ) =>
    useCalibrationStore(
      (state) => {
        if (
          totalPoints <= 0
        ) {
          return 0
        }

        return (
          state.currentPointIndex /
          totalPoints
        )
      }
    )