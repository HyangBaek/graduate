// domain/models/CalibrationPoint.ts

/**
 * 캘리브레이션 단계에서 화면에 표시되는 한 점의 위치 및 측정 데이터.
 */
export interface CalibrationPoint {
  id: number

  screenX: number
  screenY: number

  gazeX: number
  gazeY: number

  timestamp: number

  completed: boolean
}
