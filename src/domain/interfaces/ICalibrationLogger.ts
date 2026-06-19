// src/domain/interfaces/ICalibrationLogger.ts
// 캘리브레이션 로깅 인터페이스 (Domain layer) — IResearchLogger와 동일한 패턴.

import type {
  CalibrationSessionLog,
  CalibrationPointLog,
} from '@/domain/models/CalibrationLog'

/**
 * 캘리브레이션 진행 과정을 기록하는 로거 인터페이스.
 * 13점 캘리브레이션 시퀀스의 세션/점 단위 진행 상황과 게이트 실패, 강제 진행,
 * 캡처 재시도 등의 이벤트를 구조화해 기록한다.
 */
export interface ICalibrationLogger {
  /**
   * 캘리브레이션 세션 시작 (13점 시퀀스 시작 시 1회)
   * @param params 화면 크기, 전체 점 개수, 세션 출처 등 세션 시작 정보
   * @returns 생성된 캘리브레이션 세션 로그
   */
  startSession(params: {
    total_points: number
    screen_width: number
    screen_height: number
    device_pixel_ratio: number
    source: 'user' | 'debug'
  }): CalibrationSessionLog

  /**
   * 새 점으로 진입 — 이전 점이 미완료 상태로 남아있었다면 내부적으로 마무리 처리.
   * @param params 진입할 점의 인덱스, 목표 좌표, 난이도
   */
  startPoint(params: {
    point_index: number
    target_x: number
    target_y: number
    difficulty: number
  }): void

  /**
   * 현재 점에서 게이트 실패 1회 기록 (매 프레임 호출, 누적 카운트만 증가)
   * @param reason 실패 원인 게이트 종류
   */
  recordGateFailure(reason: 'edge' | 'confidence' | 'distance' | 'stability'): void

  /**
   * 9초 안전장치(forceProgress) 발동 기록
   */
  recordForceProgress(): void

  /**
   * 캡처/전환 중 예외로 재시도된 경우 기록
   */
  recordCaptureRetry(): void

  /**
   * 현재 점 캡처 완료 — 최종 confidence/stability/distance와 함께 점 로그를 확정.
   * @param finalStats 캡처 시점의 최종 confidence/stability/distance 값
   */
  completePoint(finalStats: {
    confidence: number
    stabilityScore: number
    distance: number
  }): void

  /**
   * 세션 정상 완료 (13점 모두 캡처 후 calibrationData 산출 완료)
   * @param qualityScore 최종 캘리브레이션 품질 점수 (0~100)
   */
  endSession(qualityScore: number): void

  /**
   * 세션 취소 (사용자가 `(backtick) 등으로 중단)
   */
  cancelSession(): void

  /**
   * 현재 세션 (없으면 null)
   * @returns 현재 진행 중인 캘리브레이션 세션 로그, 없으면 null
   */
  getCurrentSession(): CalibrationSessionLog | null

  /**
   * 누적된 전체 세션 기록(최근 N개)을 JSON 문자열로 반환 — 분석/다운로드용
   * @returns 세션 기록을 직렬화한 JSON 문자열
   */
  exportJson(): string

  /**
   * 저장된 모든 로그 삭제
   */
  clear(): void
}

export type { CalibrationSessionLog, CalibrationPointLog }
