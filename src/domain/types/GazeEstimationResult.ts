// src/domain/types/GazeEstimationResult.ts

import type {
  DetectedGazePoint,
} from '@domain/models/GazePoint'

/**
 * GazeEstimator의 추정 결과를 감싸는 타입.
 */
export interface GazeEstimationResult {
  gaze: DetectedGazePoint | null

  confidence: number

  timestamp: number
}
