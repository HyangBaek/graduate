// src/domain/models/CalibrationSample.ts

import type { GazePoint } from '@domain/models/GazePoint'

/**
 * 캘리브레이션 한 점에서 수집된 샘플 데이터.
 * 목표 좌표와 실제 측정된 시선 좌표 쌍으로, 회귀를 통해 보정 파라미터를 산출하는 데 사용된다.
 */
export interface CalibrationSample {
  targetX: number
  targetY: number

  gaze: GazePoint

  /*
   * 이 샘플의 신뢰도 가중치 (0~1, 기본 1)
   *
   * forceProgress(9초 안전장치)로 강제 진행된 점에서 캡처된 샘플은 실제 게이트를
   * 통과하지 못한 채 캡처된 것이라 시선-타겟 오차가 큰 경우가 많다. 이런 샘플을
   * 다른 정상 샘플과 동일한 가중치로 회귀에 포함시키면 polynomial fit 전체가
   * 왜곡되어 품질 점수가 낮아지고, 가로 이동 중 대각선으로 쓸리는 현상도 악화된다.
   * weight를 낮춰 정상 샘플 위주로 피팅되도록 한다 (완전히 0으로 버리진 않음 —
   * 그 점 자체의 위치 정보가 아예 없는 것보단 약하게라도 반영하는 게 낫다).
   */
  weight?: number
}
