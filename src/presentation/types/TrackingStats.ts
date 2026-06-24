// src/presentation/types/TrackingStats.ts

/**
 * 시선 추적 파이프라인의 실시간 성능/품질 통계.
 * gazeStore.stats에 저장되며 디버그 패널 및 분석에 사용된다.
 */
export interface TrackingStats {
  /** 초당 처리 프레임 수 */
  fps: number
  /** 처리 지연 시간(ms) */
  latency: number
  /** 처리된 누적 프레임 수 */
  frameCount: number
  /** 추적 안정성 점수 */
  stabilityScore: number
  /**
   * GazeCursor의 EASE 보간이 새 시선 목표(target)에 "정착"하기까지 걸린 실측 시간(ms).
   * target이 노이즈 임계치 이상 점프한 시점부터, 표시 위치(_lastX/Y)가 그 target의
   * SETTLE_THRESHOLD_PX 이내로 들어온 시점까지의 경과 시간 — 보간이 실제로
   * 더하는 지연을 직접 측정한 값이다(고정값 추정 아님).
   */
  predictionLatency: number
}
