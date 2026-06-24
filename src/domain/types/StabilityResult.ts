// src/domain/types/StabilityResult.ts

/**
 * StabilityService의 시선 안정성 평가 결과.
 */
export interface StabilityResult {
  isStable: boolean

  stabilityScore: number

  varianceX: number
  varianceY: number

  averageMovement: number

  sampleCount: number
}
