// src/domain/types/ProcessedGazeResult.ts

import type {
  GazePoint
} from '@domain/models/GazePoint'

/**
 * ProcessGazeUseCase가 한 프레임을 처리한 최종 결과.
 * 원본 시선 좌표와 필터링된 좌표, 신뢰도, 안정성 정보를 함께 담는다.
 */
export interface ProcessedGazeResult {
  /*
   * estimator 원본 좌표
   */
  raw: GazePoint

  /*
   * filtering 이후 좌표
   */
  filtered: GazePoint

  /*
   * tracking confidence
   */
  confidence: number

  /*
   * 안정성 여부
   */
  isStable: boolean

  /*
   * 안정성 점수
   * 0 ~ 100
   */
  stabilityScore: number

  /*
   * processing timestamp
   */
  timestamp: number
}
