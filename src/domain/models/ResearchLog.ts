// src/domain/models/ResearchLog.ts
// 연구 데이터 모델: RQ1~RQ3 기반 설계

/**
 * RQ1/RQ3: 세션 정보
 * - 읽기 시간 측정 (start_time, end_time)
 * - 사용자 만족도용 세션 식별자
 */
export interface UserSession {
  /** 세션 고유 ID (UUID) */
  session_id: string
  /** 사용자 익명 ID */
  user_id: string
  /** 문서 식별자 (파일명) */
  document_id: string
  /** 총 페이지 수 */
  total_pages: number
  /** 세션 시작 시각 (ISO 8601) */
  start_time: string
  /** 세션 종료 시각 (ISO 8601, 세션 종료 시 기록) */
  end_time: string | null
  /** eye tracking 방식 */
  tracking_mode: 'webcam' | 'sandbox'
  /**
   * 세션 출처 — 'user': 실제 읽기(뷰어) 화면에서 발생한 세션,
   * 'debug': 디버그 화면(별도 라우트)에서 발생한 GazeCursor 활동.
   * 둘을 같은 히스토리에 함께 보관하되 분석 페이지에서 구분해 보여주기 위함.
   */
  source: 'user' | 'debug'
}

/**
 * RQ2/RQ3: 시선 데이터 (샘플링)
 * - fixation duration, gaze movement, reading speed 측정
 * - 웹캠 정확도 검증용
 */
export interface GazeDataSample {
  /** 세션 참조 ID */
  session_id: string
  /** 타임스탬프 (ms, performance.now 기준) */
  timestamp: number
  /** 필터링된 시선 X 좌표 (viewport px) — GazeCursor 보간/clamp 적용 전 원본 신호 */
  gaze_x: number
  /** 필터링된 시선 Y 좌표 (viewport px) — GazeCursor 보간/clamp 적용 전 원본 신호 */
  gaze_y: number
  /**
   * GazeCursor가 실제로 화면에 그리는 X 좌표 (EASE 보간 + pdfBounds clamp 적용 완료).
   * gaze_x와 다를 수 있음 — 그 차이가 곧 "보이는 커서 움직임"과 "원본 시선 신호"의 격차.
   */
  cursor_x: number
  /** GazeCursor가 실제로 화면에 그리는 Y 좌표 (EASE 보간 + pdfBounds clamp 적용 완료) */
  cursor_y: number
  /** 현재 페이지 번호 */
  page_number: number
  /** fixation 여부 (stability score 기반) */
  is_fixation: boolean
  /** 안정성 점수 (0~1) */
  stability_score: number
  /** 신뢰도 (0~1) */
  confidence: number
  /** Dwell 진행률 – next zone (0~1) */
  next_dwell_progress: number
  /** Dwell 진행률 – prev zone (0~1) */
  prev_dwell_progress: number
}

/**
 * RQ1: 읽기 이벤트
 * - 페이지 넘김 횟수, 읽기 시간 측정
 */
export interface ReadingEvent {
  /** 세션 참조 ID */
  session_id: string
  /** 이벤트 ID */
  event_id: string
  /** 이벤트 타임스탬프 (ISO 8601) */
  timestamp: string
  /** 이벤트 종류 */
  event_type:
    | 'page_turn_next'
    | 'page_turn_prev'
    | 'page_turn_manual'
    | 'dwell_start'
    | 'dwell_complete'
    | 'session_start'
    | 'session_end'
    | 'calibration_complete'
  /** 이벤트 발생 페이지 */
  from_page: number
  /** 이동 목적 페이지 (page_turn 이벤트에서만 유효) */
  to_page: number | null
  /** 해당 페이지에서 경과한 읽기 시간 (ms) */
  reading_duration_ms: number
}
