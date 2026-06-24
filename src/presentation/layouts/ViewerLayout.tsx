// src/presentation/layouts/ViewerLayout.tsx
// PDF 시선추적 뷰어 화면의 루트 레이아웃 (디버그 모드 전용)
// Runtimes + 오버레이 컴포넌트들을 조합하며,
// 드로어 개폐 / 트래킹 / 카메라 등 뷰어 수준의 UI 상태를 관리합니다.
// GazeCursor / CalibrationOverlay / EyeGuideSplash / 자동 캘리브레이션은 AppRouter 레벨

import { useState, useEffect } from 'react'
import { useViewerStore } from '@/presentation/store/viewerStore'
import { GazeRuntime } from '@/app/runtime/GazeRuntime'
import { PdfRuntime } from '@/app/runtime/PdfRuntime'
import { NavigationRuntime } from '@/app/runtime/NavigationRuntime'
import { ResearchRuntime } from '@/app/runtime/ResearchRuntime'

import { NavigationROIHint } from '@/presentation/components/gaze/NavigationROIHint'
import { FloatingHeader } from '@/presentation/components/layout/FloatingHeader'
import { DebugDrawer } from '@/presentation/components/layout/DebugDrawer'
import { DebugPanelCluster } from '@/presentation/components/layout/DebugPanelCluster'
import { PageHotzones } from '@/presentation/components/layout/PageHotzones'
import PdfViewerPage from '@/presentation/pages/PdfViewerPage'

import { useGazeStore } from '@/presentation/state/gazeStore'

/**
 * PDF 시선추적 뷰어 화면의 루트 레이아웃(디버그 모드 전용).
 * Runtime 컴포넌트들(Pdf/Navigation/Research/Gaze)과 디버그 오버레이
 * (FloatingHeader, DebugDrawer, DebugPanelCluster, PageHotzones,
 * NavigationROIHint)를 조합하고, 드로어 개폐/추적/카메라 미리보기 등
 * 뷰어 수준 UI 상태를 관리한다. GazeCursor/CalibrationOverlay/
 * EyeGuideSplash/자동 캘리브레이션은 AppRouter 레벨에서 관리된다.
 *
 * @returns Runtime들과 PDF 뷰어, 디버그 오버레이를 포함한 레이아웃 div
 */
export function ViewerLayout() {
  // ── UI State ────────────────────────────────────────────────────────────
  const [drawerOpen,        setDrawerOpen]        = useState(false)
  const [trackingEnabled,   setTrackingEnabled]   = useState(true)
  const [showCameraPreview, setShowCameraPreview] = useState(true)
  const [showPageZones,     setShowPageZones]     = useState(true)
  const [showMonitor,       setShowMonitor]       = useState(true)

  // ── Gaze state ──────────────────────────────────────────────────────────
  const isGazeTracking = useGazeStore((s) => s.isTracking)

  // ── 디버그 모드 진입 시 public PDF 자동 로드 ──────────────────────────────
  // documentUrl / pendingFileName이 없으면 public 폴더의 샘플 PDF를 자동으로 로드
  const documentUrl    = useViewerStore((s) => s.documentUrl)
  const pendingFileName = useViewerStore((s) => s.pendingFileName)
  const setDocument    = useViewerStore((s) => s.setDocument)

  const DEBUG_PDF_NAME = 'day6 - love me or leave me.pdf'
  const DEBUG_PDF_URL  = encodeURI('/' + DEBUG_PDF_NAME)

  useEffect(() => {
    if (!documentUrl && !pendingFileName) {
      console.log('[ViewerLayout] 디버그 모드 — 샘플 PDF 자동 로드:', DEBUG_PDF_URL)
      setDocument(DEBUG_PDF_NAME, DEBUG_PDF_URL)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync drawer open state → body data attribute (webcam preview CSS positioning)
  useEffect(() => {
    if (drawerOpen) {
      document.body.setAttribute('data-drawer', 'open')
    } else {
      document.body.removeAttribute('data-drawer')
    }
    return () => document.body.removeAttribute('data-drawer')
  }, [drawerOpen])

  return (
    <div className="app-shell-container">
      {/* ── Runtimes (non-visual logic) ─────────────────────────────────── */}
      <PdfRuntime />
      <NavigationRuntime />
      <ResearchRuntime />
      {/* debug 라우트는 자체 GazeRuntime 관리 (카메라 프리뷰 지원) */}
      {trackingEnabled && (
        <GazeRuntime enableCameraPreview={showCameraPreview} />
      )}

      {/* ── Main Content ─────────────────────────────────────────────────── */}
      {/* floating header (top:16 + height:60) 아래에 PDF를 배치해 세로 비율 왜곡 방지 */}
      <div className="viewer-layout-content">
        <PdfViewerPage />
      </div>

      {/* ── Overlays ─────────────────────────────────────────────────────── */}
      <NavigationROIHint />

      {/* ── Floating Header ──────────────────────────────────────────────── */}
      <FloatingHeader
        drawerOpen={drawerOpen}
        onDrawerToggle={() => setDrawerOpen((o) => !o)}
      />

      {/* ── Page Gaze Hot-zones ───────────────────────────────────────────── */}
      {trackingEnabled && isGazeTracking && (
        <PageHotzones visible={showPageZones} />
      )}

      {/* ── Debug Panel Cluster (right side) ─────────────────────────────── */}
      <DebugPanelCluster drawerOpen={drawerOpen} />

      {/* ── Debug Drawer ──────────────────────────────────────────────────── */}
      <DebugDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        trackingEnabled={trackingEnabled}
        onToggleTracking={() => setTrackingEnabled((v) => !v)}
        showCameraPreview={showCameraPreview}
        onToggleCameraPreview={() => setShowCameraPreview((v) => !v)}
        showMonitor={showMonitor}
        onToggleMonitor={() => setShowMonitor((v) => !v)}
        showPageZones={showPageZones}
        onTogglePageZones={() => setShowPageZones((v) => !v)}
      />
    </div>
  )
}
