// src/domain/types/GazeTrackingStatus.ts

/**
 * 전체 시선 추적 파이프라인의 상태.
 */
export type GazeTrackingStatus =
  | 'idle'
  | 'initializing'
  | 'running'
  | 'stopped'
  | 'error'
