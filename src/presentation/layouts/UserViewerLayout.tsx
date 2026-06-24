// src/presentation/layouts/UserViewerLayout.tsx
// 사용자용 클린 PDF 뷰어 레이아웃
// - 탭(클릭) 시 상·하단 바 토글
// - 시선추적 ON → 하단 컨트롤 자동 반투명 숨김
// - ⋮ 메뉴: 설정, 홈, 캘리브레이션
// - GazeRuntime / CalibrationOverlay / GazeCursor / EyeGuideSplash는 AppRouter 레벨

import { useState, useCallback, useEffect, useRef } from 'react'
import { useAppRouter } from '@/app/router/useAppRouter'
import { useViewerStore } from '@/presentation/store/viewerStore'
import { useRecentFilesStore } from '@/presentation/store/recentFilesStore'
import { useGazeStore } from '@/presentation/state/gazeStore'
import { useCalibrationStore } from '@/presentation/store/calibrationStore'

import { PdfRuntime } from '@/app/runtime/PdfRuntime'
import { NavigationRuntime } from '@/app/runtime/NavigationRuntime'
import { ResearchRuntime } from '@/app/runtime/ResearchRuntime'

import PdfViewerPage from '@/presentation/pages/PdfViewerPage'
import { PageHotzones } from '@/presentation/components/layout/PageHotzones'
import { useCalibration } from '@/presentation/hooks/useCalibration'
import { PerformanceCountdownOverlay } from '@/presentation/components/performance/PerformanceCountdownOverlay'
import { PerformanceGridOverlay } from '@/presentation/components/performance/PerformanceGridOverlay'

const MAX_DOTS = 7

/**
 * 일반 사용자용 클린 PDF 뷰어 레이아웃.
 * 화면 탭으로 상/하단 바를 토글하며, 시선추적이 활성화되어 있으면 일정
 * 시간 후 하단 컨트롤을 자동으로 반투명 숨김 처리한다. ⋮ 메뉴를 통해
 * 캘리브레이션 시작, 시선추적 토글, 설정 페이지 이동을 제공한다.
 * GazeRuntime/CalibrationOverlay/GazeCursor/EyeGuideSplash는 AppRouter
 * 레벨에서 관리된다.
 *
 * @returns 상단바/콘텐츠/하단바/⋮ 메뉴로 구성된 뷰어 레이아웃 div
 */
export function UserViewerLayout() {
  const navigate = useAppRouter((s) => s.navigate)

  const currentPage = useViewerStore((s) => s.currentPage)
  const totalPages = useViewerStore((s) => s.totalPages)
  const documentName = useViewerStore((s) => s.documentName)
  const isLoading = useViewerStore((s) => s.isLoading)
  const prevPage = useViewerStore((s) => s.prevPage)
  const nextPage = useViewerStore((s) => s.nextPage)

  const updateLastPage = useRecentFilesStore((s) => s.updateLastPage)

  const isGazeTracking  = useGazeStore((s) => s.isTracking)
  const isFaceDetected  = useGazeStore((s) => s.isFaceDetected)
  const trackingEnabled = useGazeStore((s) => s.trackingEnabled)
  const setTrackingEnabled = useGazeStore((s) => s.setTrackingEnabled)
  const turnMode = useGazeStore((s) => s.turnMode)
  const isCalibrating = useCalibrationStore((s) => s.isCalibrating)

  // 설정 페이지 "넘김 방식"에 따라 자동(시선 핫존)/수동(하단 바 터치) UI를 분기
  const autoTurnEnabled   = turnMode !== 'manual'
  const manualTurnEnabled = turnMode !== 'auto'

  const { startCalibration } = useCalibration()

  const [uiVisible, setUiVisible] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [textVisible, setTextVisible] = useState(false)

  // 시선 추적 배지 5초 후 글자 사라지도록 제어
  useEffect(() => {
    if (isGazeTracking && isFaceDetected) {
      setTextVisible(true)
      const timer = setTimeout(() => {
        setTextVisible(false)
      }, 5000)
      return () => clearTimeout(timer)
    } else {
      setTextVisible(false)
    }
  }, [isGazeTracking, isFaceDetected])

  // 페이지 변경 시 최근 파일 업데이트
  const handlePageChange = useCallback(
    (page: number) => {
      if (documentName) updateLastPage(documentName, page)
    },
    [documentName, updateLastPage],
  )

  // 콘텐츠 영역 탭 → UI 토글
  const handleContentTap = () => {
    setMenuOpen(false)
    setUiVisible((v) => !v)
  }

  // 페이지 도트 (최대 MAX_DOTS개)
  const renderDots = () => {
    if (totalPages <= 1) return null
    const dots = Math.min(totalPages, MAX_DOTS)
    return (
      <div className="viewer-page-dots">
        {Array.from({ length: dots }).map((_, i) => {
          const pageForDot = Math.round((i / (dots - 1)) * (totalPages - 1)) + 1
          return (
            <div
              key={i}
              className={`viewer-page-dot ${currentPage === pageForDot ? 'active' : ''}`}
            />
          )
        })}
      </div>
    )
  }

  // 시선추적 ON + 얼굴 감지 중 → 상하단 컨트롤 자동 숨김
  useEffect(() => {
    if (isGazeTracking && isFaceDetected) {
      setUiVisible(false)
    }
  }, [isGazeTracking, isFaceDetected])

  // 메뉴에서 "시선 캘리브레이션"을 눌러 재캘리브레이션을 시작하기 전에 상단바를
  // 펼쳐둔 상태였다면, isGazeTracking/isFaceDetected는 재캘리브레이션 도중·이후에도
  // 계속 true로 유지되어(값이 바뀌지 않음) 위 effect가 다시 실행되지 않는다 —
  // 그 결과 재캘리브레이션이 끝난 뒤에도 상단바가 계속 떠 있는 상태로 남았음.
  // 뷰어 진입 시와 동일하게, 재캘리브레이션 종료(isCalibrating: true → false) 시점에
  // 시선추적 중이면 5초 후 자동으로 숨긴다.
  const wasCalibratingRef = useRef(isCalibrating)
  useEffect(() => {
    const wasCalibrating = wasCalibratingRef.current
    wasCalibratingRef.current = isCalibrating

    if (wasCalibrating && !isCalibrating && isGazeTracking && isFaceDetected) {
      const timer = setTimeout(() => {
        setUiVisible(false)
      }, 5000)
      return () => clearTimeout(timer)
    }
  }, [isCalibrating, isGazeTracking, isFaceDetected])

  // 상하단바 토글 상태에 맞춰 노출 여부 결정
  const bottomHidden = !uiVisible

  return (
    <div className="viewer-shell">
      {/* ── Non-visual Runtimes ── */}
      <PdfRuntime />
      <NavigationRuntime />
      <ResearchRuntime />

      {/* ── Overlays ── */}
      {autoTurnEnabled && trackingEnabled && isGazeTracking && (
        <PageHotzones visible={textVisible} />
      )}

      {/* ── 연주 시작 딜레이 카운트다운 / 그리드 하이라이트 ── */}
      <PerformanceCountdownOverlay />
      <PerformanceGridOverlay />

      {/* ── 상단 바 ── */}
      <header className={`viewer-topbar ${uiVisible ? '' : 'hidden'}`}>
        <button
          id="viewer-back-btn"
          className="viewer-topbar__back"
          onClick={() => navigate('home')}
          aria-label="홈으로"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <span className="viewer-topbar__title">{documentName ?? '악보'}</span>

        <button
          id="viewer-menu-btn"
          className="viewer-topbar__menu"
          onClick={(e) => {
            e.stopPropagation()
            setMenuOpen((v) => !v)
          }}
          aria-label="메뉴"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="12" cy="5" r="1.5" />
            <circle cx="12" cy="19" r="1.5" />
          </svg>
        </button>
      </header>

      {/* 시선추적 활성 배지 */}
      {isGazeTracking && isFaceDetected && (
        <div
          className={`viewer-tracking-badge ${!textVisible ? 'collapsed' : ''}`}
        >
          {textVisible && <span>시선 추적 중</span>}
        </div>
      )}

      {/* ── 로딩 오버레이 ── */}
      {isLoading && (
        <div className="viewer-loading-overlay">
          <div className="viewer-loading-spinner" />
        </div>
      )}

      {/* ── PDF 콘텐츠 ── */}
      <div
        className="viewer-content"
        onClick={handleContentTap}
        onKeyDown={(e) => {
          if (e.key === ' ') handleContentTap()
        }}
        role="presentation"
      >
        <PdfViewerPage onPageChange={handlePageChange} />
      </div>

      {/* ── 하단 컨트롤 ── */}
      <nav className={`viewer-bottombar ${bottomHidden ? 'hidden' : ''}`}>
        <button
          id="viewer-prev-btn"
          className="viewer-nav-area prev"
          onClick={(e) => {
            e.stopPropagation()
            if (manualTurnEnabled) prevPage()
          }}
          disabled={!manualTurnEnabled || currentPage <= 1}
          aria-label="이전 페이지"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <div className="viewer-page-indicator-floating">
          <span className="viewer-page-text">
            {currentPage} / {totalPages || '?'}
          </span>
          {renderDots()}
        </div>

        <button
          id="viewer-next-btn"
          className="viewer-nav-area next"
          onClick={(e) => {
            e.stopPropagation()
            if (manualTurnEnabled) nextPage()
          }}
          disabled={!manualTurnEnabled || currentPage >= totalPages}
          aria-label="다음 페이지"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </nav>

      {/* ── ⋮ 메뉴 팝업 ── */}
      {menuOpen && (
        <>
          <div
            className="viewer-menu-backdrop"
            onClick={() => setMenuOpen(false)}
          />
          <div className="viewer-menu-popup">
            <button
              className="viewer-menu-item"
              onClick={() => {
                setMenuOpen(false)
                startCalibration()
              }}
            >
              <span className="viewer-menu-item__icon">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="12" r="6" />
                  <circle cx="12" cy="12" r="2" />
                </svg>
              </span>
              시선 캘리브레이션
            </button>

            <button
              className="viewer-menu-item"
              onClick={() => {
                setMenuOpen(false)
                setTrackingEnabled(!trackingEnabled)
              }}
            >
              <span className="viewer-menu-item__icon">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </span>
              {trackingEnabled ? '시선추적 끄기' : '시선추적 켜기'}
            </button>

            <button
              className="viewer-menu-item"
              onClick={() => {
                setMenuOpen(false)
                navigate('settings')
              }}
            >
              <span className="viewer-menu-item__icon">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </span>
              설정
            </button>
          </div>
        </>
      )}
    </div>
  )
}
