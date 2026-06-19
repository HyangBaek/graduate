// src/app/runtime/ResearchRuntime.tsx
// 연구 데이터 로깅 런타임
// - 세션 시작/종료 자동 관리
// - 시선 데이터 샘플링 (gazeStore 구독)
// - 페이지 이동 이벤트 기록 (viewerStore 구독)
// - 키보드 단축키: Ctrl+Shift+D → JSON 다운로드

import { useEffect, useRef } from 'react'
import { useGazeStore } from '@/presentation/state/gazeStore'
import { useViewerStore } from '@/presentation/store/viewerStore'
import { useDebugStore } from '@/presentation/store/useDebugStore'
import { useAppRouter } from '@/app/router/useAppRouter'
import {
  researchLogger,
  ResearchLoggerImpl,
} from '@/infrastructure/storage/ResearchLoggerImpl'
import { calibrationLogger } from '@/infrastructure/storage/CalibrationLoggerImpl'

/**
 * ResearchRuntime
 *
 * 렌더 출력 없이 연구 데이터만 수집합니다.
 * ViewerLayout에서 <ResearchRuntime /> 으로 마운트하세요.
 *
 * 수집 데이터:
 * - RQ1: 세션 시간, 페이지 이동 횟수, 방향
 * - RQ2: fixation 패턴, dwell progress, gaze movement
 * - RQ3: confidence, stability_score (웹캠 정확도 지표)
 *
 * @returns null (UI를 렌더링하지 않음)
 */
export function ResearchRuntime() {
  const pageEnteredAtRef = useRef<number>(Date.now())
  const currentPageRef = useRef<number>(1)
  const sessionStartedRef = useRef(false)

  // ── 세션 출처(source) 결정 ───────────────────────────────────────────────
  // 'debug' 라우트(ViewerLayout)도 자체 ResearchRuntime을 마운트한다. 이전에는
  // 이 라우트에서의 로깅을 통째로 건너뛰었는데, 그러면 디버그 화면에서 발생하는
  // GazeCursor 활동을 전혀 분석할 수 없었다. 이제는 세션 히스토리에 함께
  // 기록하되 source: 'debug'로 태깅해 사용자(실제 읽기) 세션과 구분한다.
  // 라우트는 마운트 중 바뀌지 않으므로(라우트 전환 시 컴포넌트 자체가 unmount됨)
  // 마운트 시점 1회만 읽으면 충분하다.
  const isDebugRouteRef = useRef(
    useAppRouter.getState().currentPage === 'debug',
  )

  // ── 세션 시작 ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (sessionStartedRef.current) return
    sessionStartedRef.current = true

    const sandboxEnabled = useDebugStore.getState().sandboxEnabled
    const viewerState = useViewerStore.getState()

    researchLogger.startSession({
      user_id: 'participant_' + Math.random().toString(36).slice(2, 7),
      document_id: viewerState.documentName ?? 'unknown',
      total_pages: viewerState.totalPages,
      tracking_mode: sandboxEnabled ? 'sandbox' : 'webcam',
      source: isDebugRouteRef.current ? 'debug' : 'user',
    })

    return () => {
      researchLogger.endSession()
      sessionStartedRef.current = false
    }
  }, [])

  // ── 문서 로드 감지: viewerStore 전체 구독 후 내부에서 비교 ─────────────────
  useEffect(() => {
    let lastDocumentId = useViewerStore.getState().documentName

    const unsub = useViewerStore.subscribe((state) => {
      const newDocId = state.documentName
      if (newDocId && newDocId !== lastDocumentId && state.totalPages > 0) {
        lastDocumentId = newDocId
        researchLogger.logReadingEvent({
          event_type: 'session_start',
          from_page: 1,
          to_page: null,
          reading_duration_ms: 0,
        })
      }
    })

    return () => unsub()
  }, [])

  // ── 페이지 변경 이벤트 ───────────────────────────────────────────────────
  useEffect(() => {
    let lastPage = useViewerStore.getState().currentPage

    const unsub = useViewerStore.subscribe((state) => {
      const newPage = state.currentPage
      if (newPage !== lastPage) {
        const duration = Date.now() - pageEnteredAtRef.current
        const prevPage = lastPage

        const direction =
          newPage > prevPage
            ? ('page_turn_next' as const)
            : newPage < prevPage
              ? ('page_turn_prev' as const)
              : ('page_turn_manual' as const)

        researchLogger.logReadingEvent({
          event_type: direction,
          from_page: prevPage,
          to_page: newPage,
          reading_duration_ms: duration,
        })

        lastPage = newPage
        currentPageRef.current = newPage
        pageEnteredAtRef.current = Date.now()
      }
    })

    return () => unsub()
  }, [])

  // ── 시선 데이터 샘플링 (gazeStore – subscribeWithSelector 사용) ───────────
  useEffect(() => {
    const unsub = useGazeStore.subscribe(
      (s) => s.filteredGaze,
      (gaze) => {
        if (!gaze) return

        const s = useGazeStore.getState()
        // GazeCursor가 실제로 화면에 그리는 위치(보간+clamp 적용 완료).
        // 아직 한 번도 기록되지 않았다면(드물게 첫 프레임 이전) raw gaze로 대체.
        const cursorPos = s.cursorDisplayPos ?? gaze

        researchLogger.logGaze({
          timestamp: performance.now(),
          gaze_x: gaze.x,
          gaze_y: gaze.y,
          cursor_x: cursorPos.x,
          cursor_y: cursorPos.y,
          page_number: currentPageRef.current,
          is_fixation: (s.stats.stabilityScore ?? 0) > 0.5,
          stability_score: s.stats.stabilityScore ?? 0,
          confidence: s.confidence,
          next_dwell_progress: s.nextProgress,
          prev_dwell_progress: s.prevProgress,
        })
      },
    )
    return () => unsub()
  }, [])

  // ── 키보드 단축키: Ctrl+Shift+D → 데이터 다운로드 ───────────────────────
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault()
        if (researchLogger instanceof ResearchLoggerImpl) {
          researchLogger.downloadJson()
        }
      }
      if (e.ctrlKey && e.shiftKey && e.key === 'K') {
        e.preventDefault()
        calibrationLogger.downloadJson()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  return null
}

export default ResearchRuntime
