// src/domain/interfaces/GazeEstimator.ts

import type { FaceLandmark } from '@domain/models/FaceLandmark'

import type { DetectedGazePoint } from '@domain/models/GazePoint'

import type { CalibrationData } from '@domain/models/CalibrationData'

/**
 * 얼굴 랜드마크로부터 시선 좌표를 추정하는 인터페이스.
 */
export interface GazeEstimator {
  /**
   * 얼굴 랜드마크와 (선택적) 캘리브레이션 데이터를 사용해 시선 좌표를 추정한다.
   * @param landmark 얼굴 랜드마크 정보
   * @param calibrationData 적용할 캘리브레이션 데이터 (없으면 보정 없이 추정)
   * @returns 추정된 시선 좌표, 추정 불가 시 null
   */
  estimate(
    landmark: FaceLandmark,
    calibrationData?: CalibrationData | null,
  ): DetectedGazePoint | null
}
