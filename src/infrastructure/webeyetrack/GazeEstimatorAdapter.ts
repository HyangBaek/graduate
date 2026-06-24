// src/infrastructure/webeyetrack/GazeEstimatorAdapter.ts

import type {
  GazeEstimator,
} from '@domain/interfaces/GazeEstimator'

import type {
  CalibrationData,
} from '@domain/models/CalibrationData'

import type {
  FaceLandmark,
} from '@domain/models/FaceLandmark'

import type {
  DetectedGazePoint,
} from '@domain/models/GazePoint'

/**
 * 얼굴 landmark로부터 화면상의 시선 좌표를 추정하는 GazeEstimator 구현체.
 * 현재는 눈 중심 위치와 머리 회전을 결합한 휴리스틱(MVP 수준)으로 추정한다.
 */
export class GazeEstimatorAdapter
  implements GazeEstimator
{
  /**
   * 얼굴 landmark와 선택적 캘리브레이션 데이터로 화면상의 시선 지점을 추정한다.
   *
   * @param landmark 추출된 얼굴 landmark (눈 영역, 머리 회전 포함)
   * @param calibrationData 시선 좌표 보정을 위한 스케일/오프셋 데이터 (선택)
   * @returns 추정된 화면 좌표 기반 DetectedGazePoint, landmark가 없으면 null
   */
  estimate(
    landmark: FaceLandmark,
    calibrationData?: CalibrationData | null,
  ): DetectedGazePoint | null {
    if (!landmark) {
      return null
    }

    /*
     * 양쪽 눈 중심
     */
    const leftEye =
      landmark.leftEye.center

    const rightEye =
      landmark.rightEye.center

    /*
     * 두 눈 중심 평균
     */
    const eyeCenterX =
      (leftEye.x + rightEye.x) / 2

    const eyeCenterY =
      (leftEye.y + rightEye.y) / 2

    /*
     * head rotation
     */
    const rotation =
      landmark.rotation

    /*
     * heuristic gaze estimation
     *
     * 현재 MVP 수준:
     * eye center + head rotation 기반
     */
    let normalizedX =
      eyeCenterX + rotation.yaw * 0.15

    let normalizedY =
      eyeCenterY + rotation.pitch * 0.1

    /*
     * clamp
     */
    normalizedX = this.clamp(
      normalizedX,
      0,
      1,
    )

    normalizedY = this.clamp(
      normalizedY,
      0,
      1,
    )

    /*
     * screen 좌표 변환
     */
    let screenX =
      normalizedX * window.innerWidth

    let screenY =
      normalizedY * window.innerHeight

    /*
     * calibration 적용
     */
    if (calibrationData) {
      screenX =
        screenX *
          calibrationData.scaleX +
        calibrationData.offsetX

      screenY =
        screenY *
          calibrationData.scaleY +
        calibrationData.offsetY
    }

    return {
      x: screenX,

      y: screenY,

      timestamp: Date.now(),

      confidence:
        landmark.confidence,
    }
  }

  /**
   * 값을 [min, max] 범위로 제한한다.
   *
   * @param value 제한할 값
   * @param min 최소값
   * @param max 최대값
   * @returns 범위 내로 보정된 값
   */
  private clamp(
    value: number,
    min: number,
    max: number,
  ): number {
    return Math.min(
      Math.max(value, min),
      max,
    )
  }
}
