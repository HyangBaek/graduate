// src/domain/types/DwellResult.ts

/**
 * DwellDetectionService의 dwell(시선 머묾) 평가 결과.
 */
export interface DwellResult {
  isDwelling: boolean

  dwellTime: number

  progress: number

  completed: boolean
}
