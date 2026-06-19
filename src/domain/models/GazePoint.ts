// domain/models/GazePoint.ts

/**
 * 화면상의 시선/커서 좌표를 나타내는 기본 모델.
 */
export interface GazePoint {
  x: number
  y: number
  timestamp: number
}

/**
 * GazeEstimator가 추정한 시선 좌표 (신뢰도 및 안정성 정보 포함).
 */
export interface DetectedGazePoint
  extends GazePoint {

  confidence: number

  isStable?: boolean

  stabilityScore?: number
}
