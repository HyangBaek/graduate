// src/infrastructure/storage/ResearchLoggerImpl.ts
// IResearchLogger 구현체 (Infrastructure layer)
// - CalibrationLoggerImpl과 동일한 패턴: "현재 세션 1개"가 아니라 "최근 N개
//   세션 히스토리"를 누적 보관한다.
// - 기존에는 세션을 1개만 유지하며 새 세션이 시작되면 이전 세션이 사라졌는데,
//   그 결과 디버그 화면(별도 라우트)에서 발생하는 GazeCursor 활동을 별도로
//   기록할 방법이 없었다(같은 단일 슬롯을 서로 덮어쓰게 됨). 'user'/'debug'
//   세션을 모두 히스토리에 함께 보관하고 source로 구분해, 분석 페이지에서
//   세션을 선택해 볼 수 있게 한다.

import type { IResearchLogger } from '@/domain/interfaces/IResearchLogger'
import type {
  UserSession,
  GazeDataSample,
  ReadingEvent,
} from '@/domain/models/ResearchLog'

/** localStorage 키 — 분석 페이지(CursorAnalysisLayout)에서도 직접 읽을 수 있게 export */
export const STORAGE_KEY = 'eyescore_research_log'

/** 시선 데이터 샘플링 간격 (ms) – 30fps에서 ~5fps로 다운샘플 */
const GAZE_SAMPLE_INTERVAL_MS = 200

/** 한 세션 최대 시선 샘플 수 (메모리 보호) */
const MAX_GAZE_SAMPLES = 10_000

/** 보관할 최근 세션 수 (메모리/localStorage 보호) — CalibrationLoggerImpl과 동일 기준 */
const MAX_SESSIONS = 20

/**
 * 진행 중인 세션을 localStorage에 주기적으로 내보내는 간격(ms).
 * 기존에는 endSession() 시점에만 1회 저장했는데, 그러면 다른 탭(예: 디버그
 * 모드의 Cursor 분석 페이지)에서는 세션이 끝나기 전까지 항상 "이전에 끝난
 * 세션"만 보이고 지금 진행 중인 세션을 실시간으로 볼 수 없었다.
 * 너무 자주 쓰면 비용이 커지므로 2초 간격으로만 갱신한다.
 */
const LIVE_PERSIST_INTERVAL_MS = 2000

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function now(): string {
  return new Date().toISOString()
}

/** 세션 1개 + 그 세션에 속한 시선/이벤트 데이터를 묶은 단위 */
export interface ResearchSessionBundle {
  session: UserSession
  gazeData: GazeDataSample[]
  readingEvents: ReadingEvent[]
}

/** exportJson()/localStorage 영속화 시 사용하는 전체 묶음 형태 */
export interface ResearchLogExport {
  sessions: ResearchSessionBundle[]
  exportedAt: string
}

/**
 * IResearchLogger 구현체. 읽기 연구(research) 세션의 시선 샘플과 리딩 이벤트를
 * 메모리에 누적하고 localStorage에 영속화하며, JSON export/다운로드를 제공한다.
 */
export class ResearchLoggerImpl implements IResearchLogger {
  /** 최근 세션 히스토리 (가장 최근이 마지막, 완료/종료된 세션만) */
  private history: ResearchSessionBundle[] = []

  private session: UserSession | null = null
  private gazeData: GazeDataSample[] = []
  private readingEvents: ReadingEvent[] = []

  /** 페이지 진입 시각 (reading_duration_ms 계산용) */
  private pageEnteredAt: number = Date.now()
  private currentPage: number = 1

  /** gaze throttle */
  private lastGazeSampleTime: number = 0

  /** 진행 중 세션의 localStorage 실시간 동기화 throttle */
  private lastLivePersistTime: number = 0

  constructor() {
    this._loadFromStorage()
  }

  // ─────────────────────────────────────────────
  // Session
  // ─────────────────────────────────────────────

  /**
   * 새 연구(research) 세션을 시작하고 session_start 이벤트를 기록한다.
   *
   * @param params 사용자/문서 식별자, 전체 페이지 수, 추적 모드, 출처
   * @returns 생성된 UserSession 객체
   */
  startSession(params: {
    user_id: string
    document_id: string
    total_pages: number
    tracking_mode: 'webcam' | 'sandbox'
    source: 'user' | 'debug'
  }): UserSession {
    const session: UserSession = {
      session_id: generateId(),
      user_id: params.user_id,
      document_id: params.document_id,
      total_pages: params.total_pages,
      start_time: now(),
      end_time: null,
      tracking_mode: params.tracking_mode,
      source: params.source,
    }

    this.session = session
    this.gazeData = []
    this.readingEvents = []
    this.pageEnteredAt = Date.now()
    this.currentPage = 1
    this.lastGazeSampleTime = 0

    this._logEvent({
      event_type: 'session_start',
      from_page: 1,
      to_page: null,
      reading_duration_ms: 0,
    })

    console.info('[ResearchLogger] Session started:', session.session_id, 'source:', session.source)
    return session
  }

  /** 현재 세션을 종료하고 session_end 이벤트를 기록한 뒤 히스토리에 커밋한다. */
  endSession(): void {
    if (!this.session) return

    this.session.end_time = now()

    this._logEvent({
      event_type: 'session_end',
      from_page: this.currentPage,
      to_page: null,
      reading_duration_ms: Date.now() - this.pageEnteredAt,
    })

    this._commitSessionToHistory()
    console.info('[ResearchLogger] Session ended:', this.session?.session_id)
    this.session = null
    this.gazeData = []
    this.readingEvents = []
  }

  /** @returns 현재 진행 중인 세션, 없으면 null */
  getCurrentSession(): UserSession | null {
    return this.session
  }

  // ─────────────────────────────────────────────
  // Gaze Data (throttled)
  // ─────────────────────────────────────────────

  /**
   * 시선 데이터 샘플을 기록한다. GAZE_SAMPLE_INTERVAL_MS 간격으로 스로틀링하며,
   * 최대 샘플 수를 초과하면 가장 오래된 샘플을 제거한다(슬라이딩 윈도우).
   * 또한 일정 간격으로 진행 중인 세션을 localStorage에 동기화한다.
   *
   * @param sample session_id를 제외한 시선 데이터 샘플
   */
  logGaze(sample: Omit<GazeDataSample, 'session_id'>): void {
    if (!this.session) return

    const t = performance.now()
    if (t - this.lastGazeSampleTime < GAZE_SAMPLE_INTERVAL_MS) return
    this.lastGazeSampleTime = t

    if (this.gazeData.length >= MAX_GAZE_SAMPLES) {
      // 오래된 샘플 제거 (슬라이딩 윈도우)
      this.gazeData.splice(0, 1000)
    }

    this.gazeData.push({
      session_id: this.session.session_id,
      ...sample,
    })

    // 진행 중인 세션을 주기적으로 localStorage에 내보내, 다른 탭(디버그 모드의
    // Cursor 분석 페이지)에서 세션이 끝나기 전에도 거의 실시간으로 데이터를
    // 확인할 수 있게 한다. (해당 탭은 'storage' 이벤트로 변경을 감지한다.)
    if (t - this.lastLivePersistTime >= LIVE_PERSIST_INTERVAL_MS) {
      this.lastLivePersistTime = t
      this._persistInProgress()
    }
  }

  // ─────────────────────────────────────────────
  // Reading Events
  // ─────────────────────────────────────────────

  /**
   * 리딩 이벤트(페이지 이동 등)를 기록한다. 페이지 전환 이벤트인 경우
   * 현재 페이지와 페이지 진입 시각을 갱신한다.
   *
   * @param event session_id/event_id/timestamp를 제외한 리딩 이벤트 데이터
   */
  logReadingEvent(
    event: Omit<ReadingEvent, 'session_id' | 'event_id' | 'timestamp'>,
  ): void {
    if (!this.session) return
    this._logEvent(event)

    // 페이지 이동 시 타이머 리셋
    if (
      event.event_type === 'page_turn_next' ||
      event.event_type === 'page_turn_prev' ||
      event.event_type === 'page_turn_manual'
    ) {
      this.currentPage = event.to_page ?? this.currentPage
      this.pageEnteredAt = Date.now()
    }
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
      ? [...this.history, this._currentBundle()]
      : this.history
    const result: ResearchLogExport = {
      sessions,
      exportedAt: now(),
    }
    return JSON.stringify(result, null, 2)
  }

  /**
   * 브라우저 파일 다운로드
   */
  downloadJson(): void {
    const sessionId = this.session?.session_id ?? 'history'
    const fileName = `eyescore_research_log_${sessionId}.json`
    const blob = new Blob([this.exportJson()], {
      type: 'application/json',
    })
    // Blob URL + 임시 <a> 클릭 트릭으로 브라우저에 파일 다운로드를 트리거하고,
    // 완료 후 URL을 해제(revoke)한다.
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    URL.revokeObjectURL(url)
    console.info('[ResearchLogger] Downloaded:', fileName)
  }

  /** 메모리상의 히스토리/세션 데이터와 localStorage에 저장된 로그를 모두 삭제한다. */
  clear(): void {
    this.history = []
    this.session = null
    this.gazeData = []
    this.readingEvents = []
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch (e) {
      console.warn('[ResearchLogger] localStorage clear failed:', e)
    }
  }

  // ─────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────

  /** 현재 세션에 리딩 이벤트를 추가한다(session_id/event_id/timestamp 자동 부여). */
  private _logEvent(
    event: Omit<ReadingEvent, 'session_id' | 'event_id' | 'timestamp'>,
  ): void {
    if (!this.session) return

    this.readingEvents.push({
      session_id: this.session.session_id,
      event_id: generateId(),
      timestamp: now(),
      ...event,
    })
  }

  /** @returns 현재 세션과 그에 속한 시선 데이터/리딩 이벤트를 묶은 번들 */
  private _currentBundle(): ResearchSessionBundle {
    return {
      session: this.session as UserSession,
      gazeData: this.gazeData,
      readingEvents: this.readingEvents,
    }
  }

  /**
   * 현재 세션을 히스토리에 커밋한다. 시선 샘플이 0개인 노이즈 세션은 저장하지
   * 않고 버린다. 최대 보관 개수를 초과하면 오래된 항목을 제거한다.
   */
  private _commitSessionToHistory(): void {
    if (!this.session) return

    // 디버그 라우트를 잠깐 거쳐가기만 해도(triple-click 진입 후 즉시 이탈 등)
    // ResearchRuntime이 마운트→언마운트되며 세션을 시작·종료해버려, 시선 샘플이
    // 0개인 "노이즈" 세션이 실제 읽기 세션과 함께 분석 페이지 목록에 쌓이는
    // 문제가 있었다. 샘플이 전혀 없는 세션은 분석 가치가 없으므로 history에
    // 저장하지 않는다.
    if (this.gazeData.length === 0) {
      console.info(
        '[ResearchLogger] Discarded empty session (0 gaze samples):',
        this.session.session_id,
      )
      this._persistToStorage()
      return
    }

    this.history.push(this._currentBundle())
    if (this.history.length > MAX_SESSIONS) {
      this.history.splice(0, this.history.length - MAX_SESSIONS)
    }
    this._persistToStorage()
  }

  /** 진행 중인 세션까지 포함해 임시로 저장 (실시간 동기화용) */
  private _persistInProgress(): void {
    try {
      const sessions = this.session
        ? [...this.history, this._currentBundle()]
        : this.history
      const result: ResearchLogExport = { sessions, exportedAt: now() }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(result))
    } catch (e) {
      console.warn('[ResearchLogger] localStorage write failed:', e)
    }
  }

  /** 완료된 히스토리만 localStorage에 저장한다. */
  private _persistToStorage(): void {
    try {
      const result: ResearchLogExport = {
        sessions: this.history,
        exportedAt: now(),
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(result))
    } catch (e) {
      console.warn('[ResearchLogger] localStorage write failed:', e)
    }
  }

  /** localStorage에서 히스토리를 불러오고, 비정상 종료로 남은 고아 세션을 복구한다. */
  private _loadFromStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed?.sessions)) {
        this.history = parsed.sessions
      }
    } catch (e) {
      console.warn('[ResearchLogger] localStorage read failed:', e)
      return
    }

    // ── 고아(orphan) 세션 복구 ────────────────────────────────────────────
    // _persistInProgress()는 진행 중인 세션(end_time === null)도 그대로
    // localStorage에 내보낸다. endSession()의 React effect cleanup이 실행되지
    // 않고 끝나는 경로(새로고침, 탭/창 닫기, 강제종료, HMR)에서는 그 세션이
    // end_time === null 상태로 영원히 history에 남는다. 이 클래스가 막 생성된
    // 시점에는 아직 어떤 session도 시작하지 않았으므로(this.session === null),
    // 지금 막 불러온 history 안에 end_time이 null인 항목은 전부 "진짜로 진행
    // 중인 세션"이 아니라 이전 실행에서 종료 처리가 누락된 고아 세션이다.
    // 그대로 두면 분석 페이지에 "진행 중" 세션이 끝없이 누적되어 보이므로,
    // 마지막 기록(이벤트 또는 시작 시각)을 end_time으로 채워 종료 처리한다.
    let recoveredCount = 0
    for (const bundle of this.history) {
      if (bundle.session.end_time !== null) continue
      const lastEvent = bundle.readingEvents[bundle.readingEvents.length - 1]
      bundle.session.end_time = lastEvent?.timestamp ?? bundle.session.start_time
      recoveredCount++
    }
    if (recoveredCount > 0) {
      console.info(
        `[ResearchLogger] Recovered ${recoveredCount} orphaned session(s) ` +
          '(end_time was null on load — marked ended using last known timestamp).',
      )
      this._persistToStorage()
    }
  }
}

/**
 * 싱글턴 인스턴스 (앱 전체에서 공유)
 */
export const researchLogger = new ResearchLoggerImpl()
