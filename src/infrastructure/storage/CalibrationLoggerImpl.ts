// src/infrastructure/storage/CalibrationLoggerImpl.ts
// ICalibrationLogger 구현체 (Infrastructure layer)
// - ResearchLoggerImpl과 동일한 패턴(메모리 + localStorage 영속화 + JSON export)
// - ResearchLoggerImpl과 다른 점: "현재 세션 1개"가 아니라 "최근 N개 세션 히스토리"를
//   누적 보관한다 — 캘리브레이션은 매번 짧게 반복되므로, 한 번이 아니라 여러 번의
//   시도를 모아서 비교해야 "이 점이 항상 문제다" 같은 패턴을 분석할 수 있다.

import type { ICalibrationLogger } from '@/domain/interfaces/ICalibrationLogger'
import type {
  CalibrationSessionLog,
  CalibrationPointLog,
} from '@/domain/models/CalibrationLog'

const STORAGE_KEY = 'eyescore_calibration_log'

/** 보관할 최근 세션 수 (메모리/localStorage 보호) */
const MAX_SESSIONS = 20

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function now(): string {
  return new Date().toISOString()
}

function emptyGateFailCounts() {
  return { edge: 0, confidence: 0, distance: 0, stability: 0 }
}

/**
 * ICalibrationLogger 구현체. 캘리브레이션 세션/포인트 단위 기록을 메모리에
 * 누적하고 localStorage에 영속화하며, JSON export/다운로드 기능을 제공한다.
 */
export class CalibrationLoggerImpl implements ICalibrationLogger {
  /** 최근 세션 히스토리 (가장 최근이 마지막) */
  private history: CalibrationSessionLog[] = []

  private session: CalibrationSessionLog | null = null

  /** 빌드 중인 현재 점 로그 (completePoint/startPoint에서 history.points로 확정) */
  private pendingPoint: CalibrationPointLog | null = null
  private pendingPointEnteredAt: number = 0

  constructor() {
    this._loadFromStorage()
  }

  // ─────────────────────────────────────────────
  // Session
  // ─────────────────────────────────────────────

  /**
   * 새 캘리브레이션 세션을 시작한다.
   *
   * @param params 세션 메타데이터(목표 포인트 수, 화면 크기, 픽셀 비율, 출처)
   * @returns 생성된 세션 로그 객체
   */
  startSession(params: {
    total_points: number
    screen_width: number
    screen_height: number
    device_pixel_ratio: number
    source: 'user' | 'debug'
  }): CalibrationSessionLog {
    const session: CalibrationSessionLog = {
      session_id: generateId(),
      started_at: now(),
      ended_at: null,
      completed: false,
      total_points: params.total_points,
      screen_width: params.screen_width,
      screen_height: params.screen_height,
      device_pixel_ratio: params.device_pixel_ratio,
      quality_score: null,
      points: [],
      source: params.source,
    }

    this.session = session
    this.pendingPoint = null
    console.info('[CalibrationLogger] Session started:', session.session_id)
    return session
  }

  /**
   * 현재 세션을 정상 완료로 종료하고 히스토리에 커밋한다.
   *
   * @param qualityScore 캘리브레이션 품질 점수
   */
  endSession(qualityScore: number): void {
    if (!this.session) return
    this._finalizePendingPoint()
    this.session.ended_at = now()
    this.session.completed = true
    this.session.quality_score = qualityScore
    this._commitSessionToHistory()
    console.info('[CalibrationLogger] Session completed:', this.session.session_id, 'quality:', qualityScore)
    this.session = null
  }

  /** 현재 세션을 미완료 상태로 종료하고 히스토리에 커밋한다. */
  cancelSession(): void {
    if (!this.session) return
    this._finalizePendingPoint()
    this.session.ended_at = now()
    this.session.completed = false
    this._commitSessionToHistory()
    console.info('[CalibrationLogger] Session cancelled:', this.session.session_id)
    this.session = null
  }

  /** @returns 현재 진행 중인 세션, 없으면 null */
  getCurrentSession(): CalibrationSessionLog | null {
    return this.session
  }

  // ─────────────────────────────────────────────
  // Point-level tracking
  // ─────────────────────────────────────────────

  /**
   * 캘리브레이션 포인트(타겟 점) 1개에 대한 기록을 시작한다.
   * 활성 세션이 없으면 안전장치로 세션을 자동 시작한다.
   *
   * @param params 포인트 인덱스, 목표 좌표, 난이도
   */
  startPoint(params: {
    point_index: number
    target_x: number
    target_y: number
    difficulty: number
  }): void {
    if (!this.session) {
      // 안전장치: startSession()을 호출하지 않은 경로(예: 새 캘리브레이션 트리거 지점)에서도
      // 데이터가 조용히 사라지지 않도록 최소 정보로 세션을 자동 시작한다.
      // total_points는 point_index+1을 임시값으로 쓰고, 실제 종료 시 정확한 값으로 덮어쓰진 않지만
      // 분석 목적상 "세션이 비정상 경로로 시작됨" 자체를 알 수 있게 quality_score는 null로 유지된다.
      console.warn('[CalibrationLogger] startPoint() 호출 시 활성 세션이 없음 — 자동으로 세션을 시작합니다 (startSession() 호출 누락 가능성)')
      // Infrastructure layer라 라우트(Presentation 상태)를 직접 참조할 수 없어
      // source를 정확히 알 수 없다. 이 경로는 비정상 안전장치일 뿐이므로
      // 'user'로 보수적으로 채워두고, 위 경고 로그로 실제 원인 추적을 유도한다.
      this.startSession({
        total_points: params.point_index + 1,
        screen_width: typeof window !== 'undefined' ? window.innerWidth : 0,
        screen_height: typeof window !== 'undefined' ? window.innerHeight : 0,
        device_pixel_ratio: typeof window !== 'undefined' ? window.devicePixelRatio : 1,
        source: 'user',
      })
    }

    // 이전 점이 아직 확정 안 된 채로 남아있다면(completePoint 호출 없이 다음 점으로
    // 넘어온 비정상 케이스) 일단 그대로 마무리해서 데이터 손실 없이 기록한다.
    this._finalizePendingPoint()

    this.pendingPointEnteredAt = Date.now()
    this.pendingPoint = {
      point_index: params.point_index,
      target_x: params.target_x,
      target_y: params.target_y,
      difficulty: params.difficulty,
      started_at: now(),
      completed_at: null,
      duration_ms: 0,
      gate_fail_counts: emptyGateFailCounts(),
      force_progress: false,
      final_confidence: 0,
      final_stability_score: 0,
      final_distance: 0,
      capture_retry_count: 0,
    }
  }

  /**
   * 현재 진행 중인 포인트에서 게이트(검증 조건) 실패를 1회 기록한다.
   *
   * @param reason 실패 원인 분류
   */
  recordGateFailure(reason: 'edge' | 'confidence' | 'distance' | 'stability'): void {
    if (!this.pendingPoint) return
    this.pendingPoint.gate_fail_counts[reason] += 1
  }

  /** 현재 포인트가 게이트 조건 충족 없이 강제로 진행되었음을 표시한다. */
  recordForceProgress(): void {
    if (!this.pendingPoint) return
    this.pendingPoint.force_progress = true
  }

  /** 현재 포인트의 캡처 재시도 횟수를 1 증가시킨다. */
  recordCaptureRetry(): void {
    if (!this.pendingPoint) return
    this.pendingPoint.capture_retry_count += 1
  }

  /**
   * 현재 진행 중인 포인트를 최종 통계와 함께 확정하고 세션에 추가한다.
   * 포인트 단위로 즉시 localStorage에 영속화한다.
   *
   * @param finalStats 포인트 완료 시점의 신뢰도, 안정도, 거리 값
   */
  completePoint(finalStats: {
    confidence: number
    stabilityScore: number
    distance: number
  }): void {
    if (!this.session || !this.pendingPoint) return

    this.pendingPoint.completed_at = now()
    this.pendingPoint.duration_ms = Date.now() - this.pendingPointEnteredAt
    this.pendingPoint.final_confidence = finalStats.confidence
    this.pendingPoint.final_stability_score = finalStats.stabilityScore
    this.pendingPoint.final_distance = finalStats.distance

    this.session.points.push(this.pendingPoint)
    this.pendingPoint = null

    // 점 단위로 즉시 영속화 — 중간에 새로고침/크래시가 나도 그 점까지는 기록 보존.
    this._persistInProgress()
  }

  // ─────────────────────────────────────────────
  // Export
  // ─────────────────────────────────────────────

  /**
   * 히스토리(및 진행 중인 세션이 있다면 포함)를 JSON 문자열로 직렬화한다.
   *
   * @returns 직렬화된 JSON 문자열
   */
  exportJson(): string {
    const sessions = this.session
      ? [...this.history, this.session]
      : this.history
    return JSON.stringify(
      {
        sessions,
        exportedAt: now(),
      },
      null,
      2,
    )
  }

  /**
   * 브라우저 파일 다운로드
   */
  downloadJson(): void {
    const fileName = `eyescore_calibration_log_${Date.now()}.json`
    const blob = new Blob([this.exportJson()], { type: 'application/json' })
    // Blob URL + 임시 <a> 클릭 트릭으로 브라우저에 파일 다운로드를 트리거한다.
    // 다운로드가 끝나면 URL을 해제(revoke)해 메모리에 남지 않도록 한다.
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    URL.revokeObjectURL(url)
    console.info('[CalibrationLogger] Downloaded:', fileName)
  }

  /** 메모리상의 히스토리/세션 데이터와 localStorage에 저장된 로그를 모두 삭제한다. */
  clear(): void {
    this.history = []
    this.session = null
    this.pendingPoint = null
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch (e) {
      console.warn('[CalibrationLogger] localStorage clear failed:', e)
    }
  }

  // ─────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────

  /** 진행 중이던 포인트를 현재 값 그대로 확정해 세션에 추가한다(비정상 종료 대비). */
  private _finalizePendingPoint(): void {
    if (!this.session || !this.pendingPoint) return
    // 정상 completePoint 없이 마무리되는 경우(취소 등) — 마지막 알고 있는 값으로 확정.
    this.pendingPoint.completed_at = now()
    this.pendingPoint.duration_ms = Date.now() - this.pendingPointEnteredAt
    this.session.points.push(this.pendingPoint)
    this.pendingPoint = null
  }

  /** 현재 세션을 히스토리에 추가하고 최대 보관 개수를 초과하면 오래된 항목을 제거한다. */
  private _commitSessionToHistory(): void {
    if (!this.session) return
    this.history.push(this.session)
    if (this.history.length > MAX_SESSIONS) {
      this.history.splice(0, this.history.length - MAX_SESSIONS)
    }
    this._persistToStorage()
  }

  /** 진행 중인 세션까지 포함해 임시로 저장 (점 단위 즉시 영속화용) */
  private _persistInProgress(): void {
    try {
      const sessions = this.session ? [...this.history, this.session] : this.history
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
    } catch (e) {
      console.warn('[CalibrationLogger] localStorage write failed:', e)
    }
  }

  /** 완료된 히스토리만 localStorage에 저장한다. */
  private _persistToStorage(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.history))
    } catch (e) {
      console.warn('[CalibrationLogger] localStorage write failed:', e)
    }
  }

  /** localStorage에서 히스토리를 불러오고, 비정상 종료로 남은 고아 세션을 복구한다. */
  private _loadFromStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        this.history = parsed
      }
    } catch (e) {
      console.warn('[CalibrationLogger] localStorage read failed:', e)
      return
    }

    // ── 고아(orphan) 세션 복구 ────────────────────────────────────────────
    // ResearchLoggerImpl과 동일한 문제: _persistInProgress()가 진행 중인
    // 세션(ended_at === null)도 그대로 저장하므로, endSession()/cancelSession()
    // 호출 없이 끝나는 경로(새로고침, 강제종료, HMR)에서는 ended_at === null
    // 상태로 history에 영원히 남는다. 막 생성된 시점엔 아직 session을 시작하지
    // 않았으므로(this.session === null), 지금 불러온 history 안의 ended_at이
    // null인 항목은 모두 이전 실행에서 종료 처리가 누락된 고아 세션이다.
    let recoveredCount = 0
    for (const session of this.history) {
      if (session.ended_at !== null) continue
      const lastPoint = session.points[session.points.length - 1]
      session.ended_at = lastPoint?.completed_at ?? session.started_at
      recoveredCount++
    }
    if (recoveredCount > 0) {
      console.info(
        `[CalibrationLogger] Recovered ${recoveredCount} orphaned session(s) ` +
          '(ended_at was null on load — marked ended using last known timestamp).',
      )
      this._persistToStorage()
    }
  }
}

/**
 * 싱글턴 인스턴스 (앱 전체에서 공유)
 */
export const calibrationLogger = new CalibrationLoggerImpl()
