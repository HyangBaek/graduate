import { useState, type CSSProperties } from 'react'
import { useCalibration } from '@/presentation/hooks/useCalibration'
import { useGazeStore } from '@/presentation/state/gazeStore'
import { useDebugStore } from '@/presentation/store/useDebugStore'
import { useAppRouter } from '@/app/router/useAppRouter'
import { researchLogger } from '@/infrastructure/storage/ResearchLoggerImpl'
import { calibrationLogger } from '@/infrastructure/storage/CalibrationLoggerImpl'
import '@/presentation/styles/components/DebugDrawer.css'

/**
 * DebugDrawer 컴포넌트의 props.
 * @property open 드로어 패널이 열려 있는지 여부
 * @property onClose 드로어를 닫을 때 호출되는 콜백
 * @property trackingEnabled 웹캠 추적기 활성화 여부 (ViewerLayout 상태를 끌어올려 전달)
 * @property onToggleTracking 웹캠 추적기 on/off 토글 콜백
 * @property showCameraPreview 카메라 미리보기 표시 여부
 * @property onToggleCameraPreview 카메라 미리보기 표시 토글 콜백
 * @property showMonitor 디버그 모니터(FPS/안정성 등) 표시 여부
 * @property onToggleMonitor 디버그 모니터 표시 토글 콜백
 * @property showPageZones 페이지 이동 핫존 표시 여부
 * @property onTogglePageZones 페이지 이동 핫존 표시 토글 콜백
 */
interface DebugDrawerProps {
  open: boolean
  onClose: () => void

  // Viewer-level toggles (lifted up to ViewerLayout state)
  trackingEnabled: boolean
  onToggleTracking: () => void

  showCameraPreview: boolean
  onToggleCameraPreview: () => void

  showMonitor: boolean
  onToggleMonitor: () => void

  showPageZones: boolean
  onTogglePageZones: () => void
}

/** 사이드바가 가득 차서, SYSTEM CONTROLS/VIEW OPTIONS/DATA 대분류를 접고 펼 수 있게 함 */
type SectionKey = 'system' | 'view' | 'data'

/**
 * 섹션 접기/펴기 상태를 보여주는 화살표 아이콘.
 * @param collapsed 섹션이 접혀 있는지 여부 (true면 회전된 형태로 표시)
 * @returns 회전 클래스가 적용된 svg 화살표 아이콘
 */
function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      className={`drawer-section-chevron ${collapsed ? 'collapsed' : ''}`}
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

/**
 * 디버그/연구 모드에서 사용하는 사이드 드로어 패널.
 * 추적 상태 표시, 시스템 컨트롤(웹캠/카메라 미리보기/마우스 시뮬레이션/
 * 시선 커서/다크모드), 화면 표시 옵션(모니터/패널/핫존), 캘리브레이션
 * 시작, 연구·캘리브레이션 로그 다운로드 및 분석 페이지 이동까지
 * 한 곳에서 제어할 수 있게 한다.
 *
 * @param open 드로어 열림 여부
 * @param onClose 드로어 닫기 콜백
 * @param trackingEnabled 웹캠 추적기 활성화 여부
 * @param onToggleTracking 웹캠 추적기 토글 콜백
 * @param showCameraPreview 카메라 미리보기 표시 여부
 * @param onToggleCameraPreview 카메라 미리보기 토글 콜백
 * @param showMonitor 디버그 모니터 표시 여부
 * @param onToggleMonitor 디버그 모니터 토글 콜백
 * @param showPageZones 페이지 이동 핫존 표시 여부
 * @param onTogglePageZones 페이지 이동 핫존 토글 콜백
 * @returns 드로어 패널과 배경 클릭 시 닫기를 처리하는 backdrop을 포함한 JSX
 */
export function DebugDrawer({
  open,
  onClose,
  trackingEnabled,
  onToggleTracking,
  showCameraPreview,
  onToggleCameraPreview,
  showMonitor,
  onToggleMonitor,
  showPageZones,
  onTogglePageZones,
}: DebugDrawerProps) {
  const { isCalibrating, isCalibrated, startCalibration } = useCalibration()
  const navigate = useAppRouter((s) => s.navigate)

  // Debug control states
  const sandboxEnabled = useDebugStore((s) => s.sandboxEnabled)
  const setSandboxEnabled = useDebugStore((s) => s.setSandboxEnabled)
  const cursorVisible = useDebugStore((s) => s.cursorVisible)
  const setCursorVisible = useDebugStore((s) => s.setCursorVisible)
  const cursorDebugVisible = useDebugStore((s) => s.cursorDebugVisible)
  const setCursorDebugVisible = useDebugStore((s) => s.setCursorDebugVisible)
  const prevPageZoneEnabled = useDebugStore((s) => s.prevPageZoneEnabled)
  const setPrevPageZoneEnabled = useDebugStore((s) => s.setPrevPageZoneEnabled)
  const isDebugVisible = useDebugStore((s) => s.isVisible)
  const toggleDebugVisible = useDebugStore((s) => s.toggleVisibility)

  // Gaze store states
  const isFaceDetected = useGazeStore((s) => s.isFaceDetected)
  const isGazeTracking = useGazeStore((s) => s.isTracking)
  const fps = useGazeStore((s) => s.stats.fps)
  const stability = useGazeStore((s) => s.stats.stabilityScore)
  const nextProgress = useGazeStore((s) => s.nextProgress)
  const prevProgress = useGazeStore((s) => s.prevProgress)

  // Dark Mode state (default to false / light theme active)
  const [darkMode, setDarkMode] = useState(() => {
    return (
      document.body.classList.contains('dark-mode') ||
      localStorage.getItem('theme') === 'dark'
    )
  })

  // ── 대분류 섹션 접기/펴기 (사이드바 과밀 해소) ──────────────────────────
  const [collapsedSections, setCollapsedSections] = useState<
    Record<SectionKey, boolean>
  >({ system: false, view: false, data: false })

  const toggleSection = (key: SectionKey) => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const handleToggleDarkMode = () => {
    const nextVal = !darkMode
    setDarkMode(nextVal)
    if (nextVal) {
      document.body.classList.add('dark-mode')
      localStorage.setItem('theme', 'dark')
    } else {
      document.body.classList.remove('dark-mode')
      localStorage.setItem('theme', 'light')
    }
  }

  const goToAnalysisPage = (page: 'calibration-analysis' | 'cursor-analysis') => {
    navigate(page)
    onClose()
  }

  const zoneLabel =
    nextProgress > 0 ? 'BOTTOM' : prevProgress > 0 ? 'TOP' : 'PAGE'
  const zoneClass =
    nextProgress > 0
      ? 'zone-next'
      : prevProgress > 0
        ? 'zone-prev'
        : 'zone-page'

  // Derive status badge
  const status = (() => {
    if (!trackingEnabled) return { text: 'Tracking Offline', color: '#888' }
    if (!isGazeTracking) return { text: 'Starting...', color: '#ffaa00' }
    if (!isFaceDetected) return { text: 'No Face Detected', color: '#ff4444' }
    if (!isCalibrated) return { text: 'Uncalibrated', color: '#ffaa00' }
    return { text: 'Calibrated (Ready)', color: '#00cc66' }
  })()

  const canCalibrate = (trackingEnabled || sandboxEnabled) && !isCalibrating

  const handleCalibrate = () => {
    startCalibration()
    onClose()
  }

  return (
    <>
      <div className={`debug-drawer ${open ? 'open' : ''}`}>
        <div className="debug-drawer-header">
          <h3>Debug Controls</h3>
          <button
            className="debug-drawer-close"
            onClick={onClose}
            aria-label="Close drawer"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="debug-drawer-close-icon"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="debug-drawer-body">
          {/* ── Tracking Status ── */}
          <div className="drawer-group">
            <h4>TRACKING STATUS</h4>
            <div className="drawer-status-badge">
              <span
                className="status-dot"
                style={{ '--status-color': status.color } as CSSProperties}
              />
              <span className="status-text">{status.text}</span>
            </div>
          </div>

          {/* ── Monitor ── */}
          <div className="drawer-group">
            <h4>MONITOR</h4>
            <div
              className={`drawer-monitor-inline ${showMonitor ? '' : 'collapsed'}`}
            >
              <div className="drawer-monitor-row">
                <span className="monitor-key">FPS</span>
                <span className="monitor-val fps">{fps}</span>
              </div>
              <div className="drawer-monitor-row">
                <span className="monitor-key">STABILITY</span>
                <span
                  className={`monitor-val ${stability > 40 ? 'ok' : 'err'}`}
                >
                  {stability.toFixed(0)}%
                </span>
              </div>
              <div className="drawer-monitor-row">
                <span className="monitor-key">GAZE ZONE</span>
                <span className={`monitor-val ${zoneClass}`}>{zoneLabel}</span>
              </div>
            </div>
          </div>

          {/* ── Calibration ── */}
          <div className="drawer-group">
            <h4>CALIBRATION</h4>
            <button
              onClick={handleCalibrate}
              disabled={!canCalibrate}
              className="drawer-btn primary"
            >
              {isCalibrating
                ? 'Calibrating...'
                : isCalibrated
                  ? 'Recalibrate Eye'
                  : 'Calibrate Eye Tracking'}
            </button>
          </div>

          <div className="drawer-group-divider" />

          {/* ── System Controls (접기/펴기) ── */}
          <div className="drawer-group">
            <h4
              className="collapsible"
              onClick={() => toggleSection('system')}
            >
              SYSTEM CONTROLS
              <ChevronIcon collapsed={collapsedSections.system} />
            </h4>

            <div
              className={`drawer-section-body ${
                collapsedSections.system ? 'collapsed' : ''
              }`}
            >
              <div className="drawer-row-toggle">
                <span className="row-label">Webcam Tracker</span>
                <button
                  onClick={onToggleTracking}
                  className={`toggle-switch-btn ${trackingEnabled ? 'on' : 'off'}`}
                >
                  {trackingEnabled ? 'RUNNING' : 'STOPPED'}
                </button>
              </div>

              <div className="drawer-row-toggle">
                <span className="row-label">Camera Preview</span>
                <button
                  onClick={onToggleCameraPreview}
                  disabled={!trackingEnabled}
                  className={`toggle-switch-btn ${showCameraPreview && trackingEnabled ? 'on' : 'off'}`}
                >
                  {showCameraPreview && trackingEnabled ? 'SHOWN' : 'HIDDEN'}
                </button>
              </div>

              <div className="drawer-row-toggle">
                <span className="row-label">Mouse Simulation</span>
                <button
                  onClick={() => setSandboxEnabled(!sandboxEnabled)}
                  className={`toggle-switch-btn ${sandboxEnabled ? 'on' : 'off'}`}
                >
                  {sandboxEnabled ? 'ON' : 'OFF'}
                </button>
              </div>

              <div className="drawer-row-toggle">
                <span className="row-label">Gaze Cursor</span>
                <button
                  onClick={() => setCursorVisible(!cursorVisible)}
                  className={`toggle-switch-btn ${cursorVisible ? 'on' : 'off'}`}
                >
                  {cursorVisible ? 'SHOWN' : 'HIDDEN'}
                </button>
              </div>

              <div className="drawer-row-toggle">
                <span className="row-label">Cursor Info</span>
                <button
                  onClick={() => setCursorDebugVisible(!cursorDebugVisible)}
                  className={`toggle-switch-btn ${cursorDebugVisible ? 'on' : 'off'}`}
                >
                  {cursorDebugVisible ? 'SHOWN' : 'HIDDEN'}
                </button>
              </div>

              <div className="drawer-row-toggle">
                <span className="row-label">Dark Mode</span>
                <button
                  onClick={handleToggleDarkMode}
                  className={`toggle-switch-btn ${darkMode ? 'on' : 'off'}`}
                >
                  {darkMode ? 'DARK' : 'LIGHT'}
                </button>
              </div>
            </div>
          </div>

          <div className="drawer-group-divider" />

          {/* ── View Options (접기/펴기) ── */}
          <div className="drawer-group">
            <h4 className="collapsible" onClick={() => toggleSection('view')}>
              VIEW OPTIONS
              <ChevronIcon collapsed={collapsedSections.view} />
            </h4>

            <div
              className={`drawer-section-body ${
                collapsedSections.view ? 'collapsed' : ''
              }`}
            >
              <div className="drawer-row-toggle">
                <span className="row-label">Debug Monitor</span>
                <button
                  onClick={onToggleMonitor}
                  className={`toggle-switch-btn ${showMonitor ? 'on' : 'off'}`}
                >
                  {showMonitor ? 'SHOWN' : 'HIDDEN'}
                </button>
              </div>

              <div className="drawer-row-toggle">
                <span className="row-label">Debug Panels</span>
                <button
                  onClick={toggleDebugVisible}
                  className={`toggle-switch-btn ${isDebugVisible ? 'on' : 'off'}`}
                >
                  {isDebugVisible ? 'SHOWN' : 'HIDDEN'}
                </button>
              </div>

              <div className="drawer-row-toggle">
                <span className="row-label">Page Zones</span>
                <button
                  onClick={onTogglePageZones}
                  className={`toggle-switch-btn ${showPageZones ? 'on' : 'off'}`}
                >
                  {showPageZones ? 'SHOWN' : 'HIDDEN'}
                </button>
              </div>

              <div className="drawer-row-toggle drawer-row-toggle--indent">
                <span className="row-label">└ Prev Page Zone</span>
                <button
                  onClick={() => setPrevPageZoneEnabled(!prevPageZoneEnabled)}
                  disabled={!showPageZones}
                  className={`toggle-switch-btn ${prevPageZoneEnabled && showPageZones ? 'on' : 'off'}`}
                >
                  {prevPageZoneEnabled && showPageZones ? 'ENABLED' : 'DISABLED'}
                </button>
              </div>
            </div>
          </div>

          <div className="drawer-group-divider" />

          {/* ── Data (RESEARCH DATA + CALIBRATION DATA 통합, 접기/펴기) ── */}
          <div className="drawer-group">
            <h4 className="collapsible" onClick={() => toggleSection('data')}>
              DATA
              <ChevronIcon collapsed={collapsedSections.data} />
            </h4>

            <div
              className={`drawer-section-body ${
                collapsedSections.data ? 'collapsed' : ''
              }`}
            >
              {/* 분석 페이지 바로가기 — 매번 JSON을 받아 해석하지 않아도 되도록 */}
              <button
                onClick={() => goToAnalysisPage('calibration-analysis')}
                className="drawer-btn primary drawer-mb-8"
              >
                캘리브레이션 결과 분석 페이지 →
              </button>
              <button
                onClick={() => goToAnalysisPage('cursor-analysis')}
                className="drawer-btn primary drawer-mb-12"
              >
                Gaze Cursor 분석 페이지 →
              </button>

              <h4 className="drawer-mb-4">RESEARCH LOG</h4>
              <div className="drawer-monitor-inline drawer-mb-8">
                <div className="drawer-monitor-row">
                  <span className="monitor-key">SESSION</span>
                  <span className="monitor-val ok drawer-session-id">
                    {researchLogger.getCurrentSession()?.session_id?.slice(-8) ??
                      'none'}
                  </span>
                </div>
              </div>
              <button
                onClick={() => (researchLogger as any).downloadJson?.()}
                className="drawer-btn primary drawer-download-btn"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Download Session JSON
              </button>
              <p className="drawer-hint drawer-hint--spaced">
                Ctrl+Shift+D 로도 다운로드 가능
              </p>

              <h4 className="drawer-mb-4">CALIBRATION LOG</h4>
              <div className="drawer-monitor-inline drawer-mb-8">
                <div className="drawer-monitor-row">
                  <span className="monitor-key">SESSIONS</span>
                  <span className="monitor-val ok">
                    {JSON.parse(calibrationLogger.exportJson()).sessions?.length ?? 0}
                  </span>
                </div>
              </div>
              <button
                onClick={() => (calibrationLogger as any).downloadJson?.()}
                className="drawer-btn primary drawer-download-btn"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Download Calibration Log JSON
              </button>
              <p className="drawer-hint">
                Ctrl+Shift+K 로도 다운로드 가능<br />
                 — 최근 {`20`}회 캘리브레이션 시도의<br />
                점별 게이트 실패 횟수와 forceProgress 발동 여부 포함
              </p>
            </div>
          </div>
        </div>
      </div>

      {open && (
        <div
          className="debug-drawer-backdrop"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
    </>
  )
}
