// src/domain/models/CalibrationLog.ts
// 캘리브레이션 진행 과정 로깅 모델
//
// ResearchLog.ts(읽기 행동 분석용)와 같은 목적으로, 캘리브레이션 자체의 품질/문제를
// 나중에 분석할 수 있도록 구조화한다. 매 프레임의 원시 게이트 판정을 전부 쌓으면
// 데이터가 너무 커지므로, 점(point) 단위로 "이 점에서 무슨 일이 있었는지"를 요약해
// 기록하는 방식을 택한다(어떤 게이트가 몇 번 막았는지, 강제 진행이 발동했는지 등).

/**
 * 한 번의 캘리브레이션 시도(13점 전체) 단위 세션
 */
export interface CalibrationSessionLog {
  /** 세션 고유 ID */
  session_id: string
  /** 시작 시각 (ISO 8601) */
  started_at: string
  /** 종료 시각 (완료/취소 시 기록, 진행 중이면 null) */
  ended_at: string | null
  /** 정상 완료 여부 (false면 cancelCalibration으로 중단됨) */
  completed: boolean
  /** 전체 점 개수 */
  total_points: number
  /** 화면 크기 (px) — GAIN/거리 게이트가 화면 크기에 의존하므로 분석 시 필요 */
  screen_width: number
  screen_height: number
  device_pixel_ratio: number
  /** 최종 캘리브레이션 품질 점수 (CalibrationService.calculateQualityScore, 0~100) */
  quality_score: number | null
  /** 이 세션에서 수집된 점별 로그 */
  points: CalibrationPointLog[]
  /**
   * 세션 출처 — 'user': 실제 사용자 플로우(앱 시작 자동 캘리브레이션, viewer
   * 화면에서 트리거)에서 발생한 세션, 'debug': 디버그 화면(DebugDrawer)에서
   * 수동으로 트리거한 세션. ResearchLog.ts의 UserSession.source와 동일한 목적.
   */
  source: 'user' | 'debug'
}

/**
 * 캘리브레이션 한 점(point)에 대한 요약 로그.
 * 매 프레임 기록이 아니라, 그 점에 머문 동안의 집계값.
 */
export interface CalibrationPointLog {
  /** 점 순서 (0-based) */
  point_index: number
  /** 점의 화면상 목표 위치 (정규화 0~1) */
  target_x: number
  target_y: number
  /** calibrationPoints.ts의 difficulty (0~1) */
  difficulty: number
  /** 이 점 진입 시각 (ISO 8601) */
  started_at: string
  /** 캡처 완료(다음 점 이동) 시각 (ISO 8601) */
  completed_at: string | null
  /** 이 점에 머문 총 시간(ms) — dwell 성공까지 걸린 실제 시간(stuckTime과 동일 개념) */
  duration_ms: number
  /**
   * 게이트별 실패 프레임 수 — 어떤 게이트가 이 점을 가장 많이 막았는지 분석하는 데 사용.
   * (예: confidence가 압도적으로 높으면 "이 점/사용자는 인식 신뢰도가 구조적으로 약하다"는 신호)
   */
  gate_fail_counts: {
    edge: number
    confidence: number
    distance: number
    stability: number
  }
  /**
   * 9초 안전장치(forceProgress)로 강제 진행됐는지 여부.
   * true면 정상 게이트로는 끝내 통과하지 못했다는 뜻 — 분석 시 우선적으로 봐야 할 점.
   */
  force_progress: boolean
  /** 캡처 시점의 최종 confidence / stability / target과의 거리(px) */
  final_confidence: number
  final_stability_score: number
  final_distance: number
  /** 캡처/전환 중 예외가 발생해 재시도된 횟수 (정상은 0) */
  capture_retry_count: number
}
