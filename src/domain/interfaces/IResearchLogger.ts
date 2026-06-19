// src/domain/interfaces/IResearchLogger.ts
// 연구 데이터 로깅 인터페이스 (Domain layer)

import type {
  UserSession,
  GazeDataSample,
  ReadingEvent,
} from '@/domain/models/ResearchLog'

/**
 * 연구 데이터(읽기 행동, 시선 샘플 등) 로깅 인터페이스.
 */
export interface IResearchLogger {
  /**
   * 세션 시작
   * @param params 사용자/문서/페이지 수/추적 모드 등 세션 시작 정보
   * @returns 생성된 UserSession (session_id 포함)
   */
  startSession(params: {
    user_id: string
    document_id: string
    total_pages: number
    tracking_mode: 'webcam' | 'sandbox'
    source: 'user' | 'debug'
  }): UserSession

  /**
   * 세션 종료
   */
  endSession(): void

  /**
   * 시선 데이터 샘플 기록 (고빈도 호출 – 내부에서 throttle/sample 처리)
   * @param sample 세션 ID를 제외한 시선 데이터 샘플
   */
  logGaze(sample: Omit<GazeDataSample, 'session_id'>): void

  /**
   * 읽기 이벤트 기록
   * @param event 세션 ID/이벤트 ID/타임스탬프를 제외한 읽기 이벤트 정보
   */
  logReadingEvent(event: Omit<ReadingEvent, 'session_id' | 'event_id' | 'timestamp'>): void

  /**
   * 현재 세션의 전체 로그를 JSON 문자열로 반환
   * @returns 직렬화된 JSON 문자열
   */
  exportJson(): string

  /**
   * 현재 세션 정보
   * @returns 현재 진행 중인 UserSession, 없으면 null
   */
  getCurrentSession(): UserSession | null

  /**
   * 데이터 초기화
   */
  clear(): void
}
