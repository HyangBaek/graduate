// src/app/router/AppRouter.tsx
// 앱 진입점 라우터
// - 앱 시작 시 EyeGuideSplash 표시
// - 스플래시 중 GazeRuntime 워밍업 + 레이아웃 청크 프리로드
// - 스플래시 완료 즉시 home 렌더 → CalibrationOverlay가 위에 오버레이
//
// ── LCP 최적화 ────────────────────────────────────────────────────────────
//  이전: showRoute = splashDone && !isCalibrating && (!needsCalibration || declined)
//    → 캘리브레이션 완료까지 home이 렌더되지 않음 (LCP 10s+)
//  현재: showRoute = splashDone
//    → 스플래시(1.1s) 직후 home 즉시 렌더
//    → CalibrationOverlay(position:fixed, z-index 최상위)가 필요 시 위에 올라옴
//    → 캘리브레이션 완료/취소 즉시 overlay 사라지고 home 바로 사용 가능

import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { useAppRouter, type AppPage } from './useAppRouter'

// ── 레이아웃 코드 스플리팅 ────────────────────────────────────────────────────
// 초기 번들에서 제외 → 스플래시/캘리브레이션 완료 후 첫 렌더 시점에 로드
// 각 레이아웃은 고유한 청크로 분리되어 병렬 다운로드됨
// _preload*: AppRouter 마운트 시(스플래시 중) 즉시 프리로드
//   → showRoute=true 또는 navigate('viewer') 시 청크 다운로드 대기 없이 즉시 렌더
//   _preloadViewer: UserViewerLayout(+PdfRuntime, pdfPreloadManager) 청크 포함
//     → viewer 첫 진입 시 청크가 이미 캐시에 있어 Suspense 대기 없음
const _preloadHome     = () => import('@/presentation/layouts/HomeLayout')
const _preloadViewer   = () => import('@/presentation/layouts/UserViewerLayout')
const _preloadSettings = () => import('@/presentation/layouts/SettingsLayout')

const HomeLayout       = lazy(() => _preloadHome().then(m => ({ default: m.HomeLayout })))
const UserViewerLayout = lazy(() => _preloadViewer().then(m => ({ default: m.UserViewerLayout })))
const SettingsLayout   = lazy(() => _preloadSettings().then(m => ({ default: m.SettingsLayout })))
const ViewerLayout     = lazy(() => import('@/presentation/layouts/ViewerLayout').then(m => ({ default: m.ViewerLayout })))

// 디버그 메뉴 전용 분석 페이지 — 디버그로 진입한 뒤에만 필요하므로 사전 프리로드하지 않음
const CalibrationAnalysisLayout = lazy(() =>
  import('@/presentation/layouts/CalibrationAnalysisLayout').then(m => ({ default: m.CalibrationAnalysisLayout })),
)
const CursorAnalysisLayout = lazy(() =>
  import('@/presentation/layouts/CursorAnalysisLayout').then(m => ({ default: m.CursorAnalysisLayout })),
)

import { GazeRuntime } from '@/app/runtime/GazeRuntime'
import { CalibrationOverlay } from '@/presentation/components/calibration/CalibrationOverlay'
import { GazeCursor } from '@/presentation/components/gaze/GazeCursor'
import { EyeGuideSplash } from '@/presentation/components/splash/EyeGuideSplash'
import { CameraGazeWarningOverlay } from '@/presentation/components/gaze/CameraGazeWarningOverlay'

import { useCalibrationStore } from '@/presentation/store/calibrationStore'
import { useGazeStore } from '@/presentation/state/gazeStore'
import { useDebugStore } from '@/presentation/store/useDebugStore'
import { calibrationLogger } from '@/infrastructure/storage/CalibrationLoggerImpl'
import { CALIBRATION_POINTS } from '@/presentation/constants/calibrationPoints'

const CALIBRATION_INTERVAL_MS = 30 * 60 * 1000 // 30분

// ── 모듈 레벨 플래그 ─────────────────────────────────────────────────────────
// React StrictMode에서 mount → unmount → remount 시 스플래시 재실행 방지.
let _splashShown = false

// 디버그 메뉴 계열 페이지 — 진입 시 스플래시/자동 캘리브레이션을 건너뛴다.
// 캘리브레이션은 DebugDrawer의 "CALIBRATION" 버튼(리캘리브레이션)을 눌렀을 때만 진행된다.
const DEBUG_PAGES: readonly AppPage[] = ['debug', 'calibration-analysis', 'cursor-analysis']
function isDebugPage(page: AppPage): boolean {
  return DEBUG_PAGES.includes(page)
}

export function AppRouter() {
  const currentPage = useAppRouter((s) => s.currentPage)

  // ── 레이아웃 청크 프리로드 (스플래시 재생 중 백그라운드 다운로드) ──────────
  useEffect(() => {
    _preloadHome()
    _preloadViewer()   // UserViewerLayout + PdfRuntime + pdfPreloadManager 청크 프리로드
    _preloadSettings()
  }, [])

  // ── 앱 진입 스플래시 (세션 1회) ───────────────────────────────────────────
  // 디버그 계열 경로로 진입했는지는 최초 마운트 시점의 currentPage로만 판단한다.
  // (이후 디버그 → 홈 등으로 이동해도 스플래시를 다시 띄우지 않기 위함)
  const [skipSplash] = useState(() => isDebugPage(currentPage))
  const [splashDone, setSplashDone] = useState(() => _splashShown || skipSplash)

  // ── Gaze / Calibration 상태 ────────────────────────────────────────────────
  const trackingEnabled    = useGazeStore((s) => s.trackingEnabled)
  const gazeCursorEnabled  = useCalibrationStore((s) => s.gazeCursorEnabled)
  const cursorDebugVisible = useDebugStore((s) => s.cursorDebugVisible)
  const isHydrated        = useCalibrationStore((s) => s.isHydrated)

  // ── startCalibration — getState() 직접 호출 (구독 불필요) ─────────────────
  const startCalibration = useCallback(() => {
    useCalibrationStore.getState().startCalibration()
    useGazeStore.getState().triggerBaselineReset()
    // 원인: 이 자동 캘리브레이션 시작 경로가 useCalibration() 훅을 거치지 않고
    // calibrationStore를 직접 호출해서, calibrationLogger.startSession()이
    // 한 번도 호출되지 않았음 — 그 결과 점별 기록(startPoint/recordGateFailure/
    // completePoint)과 endSession이 전부 session===null로 조용히 무시되어
    // 다운로드한 JSON이 항상 빈 배열로 나왔음. 여기서도 동일하게 세션을 시작한다.
    calibrationLogger.startSession({
      total_points: CALIBRATION_POINTS.length,
      screen_width: window.innerWidth,
      screen_height: window.innerHeight,
      device_pixel_ratio: window.devicePixelRatio,
      // 앱 시작 시 스플래시 직후 자동으로 트리거되는 경로 — 항상 실제 사용자
      // 플로우(home 진입 전)이므로 'user'로 고정.
      source: 'user',
    })
  }, [])

  // ── 필요 시 자동 캘리브레이션 시작 ──────────────────────────────────────────
  // hydration 완료 및 스플래시 종료가 모두 확인된 시점에 안전하게 트리거하여
  // hydration 완료 콜백(onRehydrateStorage)이 isCalibrating을 false로 덮어쓰는 레이스 컨디션을 방지한다.
  useEffect(() => {
    if (!isHydrated || !splashDone || skipSplash) return

    const cal = useCalibrationStore.getState()
    const needs =
      !cal.isCalibrated ||
      cal.lastCalibratedAt === null ||
      Date.now() - cal.lastCalibratedAt > CALIBRATION_INTERVAL_MS

    if (needs && !cal.isCalibrating) {
      startCalibration()
    }
  }, [isHydrated, splashDone, skipSplash, startCalibration])

  // ── 스플래시 완료 콜백 ────────────────────────────────────────────────────
  // 1. 모듈 플래그 → StrictMode 재마운트 시 재실행 방지
  const handleSplashComplete = useCallback(() => {
    _splashShown = true
    setSplashDone(true)
  }, [])

  // GazeCursor 표시 규칙:
  //   viewer  → gazeCursorEnabled 설정 토글
  //   debug   → cursorDebugVisible 토글
  //   home / settings → 항상 숨김
  const showCursor =
    (currentPage === 'viewer' && gazeCursorEnabled) ||
    (currentPage === 'debug' && cursorDebugVisible)

  // 라우트 콘텐츠
  const routeContent = (() => {
    switch (currentPage) {
      case 'home':     return <HomeLayout />
      case 'viewer':   return <UserViewerLayout />
      case 'settings': return <SettingsLayout />
      case 'debug':    return <ViewerLayout />
      case 'calibration-analysis': return <CalibrationAnalysisLayout />
      case 'cursor-analysis':      return <CursorAnalysisLayout />
      default:         return <HomeLayout />
    }
    console.log(showCursor)
  })()

  // ── showRoute = splashDone ────────────────────────────────────────────────
  // 스플래시 완료 즉시 home 렌더.
  // 캘리브레이션이 필요하면 CalibrationOverlay(position:fixed)가 위에 올라와 가림.
  // 캘리브레이션 완료/취소 → overlay 사라짐 → home 바로 사용 가능.
  const showRoute = splashDone

  return (
    <>
      {/* 앱 전역 GazeRuntime — 스플래시 중에도 카메라 워밍업 */}
      {trackingEnabled && currentPage !== 'debug' && (
        <GazeRuntime enableCameraPreview={false} />
      )}

      {/* 앱 전역 오버레이 — CalibrationOverlay는 isCalibrating 시에만 렌더 */}
      <CalibrationOverlay />
      {showCursor && (
        <GazeCursor debug={currentPage === 'debug' && cursorDebugVisible} />
      )}
      <CameraGazeWarningOverlay />
      {/* <MockCalibrationOverlay /> */}

      {/* 앱 진입 스플래시 */}
      {!splashDone && (
        <EyeGuideSplash onComplete={handleSplashComplete} />
      )}

      {/* 라우트 — 스플래시 완료 즉시 렌더 */}
      {showRoute && (
        <Suspense fallback={null}>
          {routeContent}
        </Suspense>
      )}
    </>
  )
}
