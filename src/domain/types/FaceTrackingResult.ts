// src/domain/types/FaceTrackingResult.ts

import type {
  FaceLandmark,
} from '@domain/models/FaceLandmark'

/**
 * 얼굴 추적 결과 (types 버전). interfaces/FaceTracker.ts의 동명 타입과 동일한 목적.
 */
export interface FaceTrackingResult {
  landmarks: FaceLandmark[]

  confidence: number

  isFaceDetected: boolean

  timestamp: number
}
