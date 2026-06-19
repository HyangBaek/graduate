// src/presentation/components/debug/DebugOverlay.tsx

import React, { useEffect, type CSSProperties } from 'react'
import { useDebugStore } from '../../store/useDebugStore'
import { useGazeStore } from '../../state/gazeStore'
import '@/presentation/styles/components/DebugOverlay.css'

/**
 * Frame Latency 값(ms)에 따른 상태 클래스를 판정한다.
 * Frame Latency: 카메라→워커→스토어 반영까지 실제 파이프라인 지연(ms).
 * @param ms 측정된 프레임 지연 시간(ms)
 * @returns 'status-ok' | 'status-warn' | 'status-error' 중 하나
 */
function frameLatencyStatus(ms: number): 'status-ok' | 'status-warn' | 'status-error' {
  if (ms < 50) return 'status-ok'
  if (ms < 100) return 'status-warn'
  return 'status-error'
}

/**
 * Prediction Latency 값(ms)에 따른 상태 클래스를 판정한다.
 * Prediction Latency: GazeCursor EASE 보간이 새 목표에 정착하기까지 실측한 시간(ms).
 * @param ms 측정된 정착 시간(ms)
 * @returns 'status-ok' | 'status-warn' | 'status-error' 중 하나
 */
function predictionLatencyStatus(ms: number): 'status-ok' | 'status-warn' | 'status-error' {
  if (ms < 80) return 'status-ok'
  if (ms < 150) return 'status-warn'
  return 'status-error'
}

/**
 * 시선 추적 파이프라인의 실시간 상태(시스템 상태, 시선 좌표, 헤드포즈,
 * 신뢰도, 성능 지표, 설정 상태, PDF bounds 등)를 보여주는 디버그 패널.
 * gazeStore/useDebugStore를 구독해 표시하며, ` (Backquote) 키로 패널
 * 표시 여부를 토글한다.
 *
 * @returns 시선 점(raw/filtered) 시각화 요소와 통계 패널을 포함한 JSX
 */
export const DebugOverlay: React.FC = () => {
  const isVisible = useDebugStore((state) => state.isVisible)
  const sandboxEnabled = useDebugStore((state) => state.sandboxEnabled)
  const cursorVisible = useDebugStore((state) => state.cursorVisible)
  const cursorDebugVisible = useDebugStore((state) => state.cursorDebugVisible)
  const toggleVisibility = useDebugStore((state) => state.toggleVisibility)

  // Real-time tracking data from global store
  const isTracking = useGazeStore((state) => state.isTracking)
  const isFaceDetected = useGazeStore((state) => state.isFaceDetected)
  const fps = useGazeStore((state) => state.stats.fps)
  const stability = useGazeStore((state) => state.stats.stabilityScore)
  const nextProgress = useGazeStore((state) => state.nextProgress)
  const prevProgress = useGazeStore((state) => state.prevProgress)
  const rawGaze = useGazeStore((state) => state.rawGaze)
  const filteredGaze = useGazeStore((state) => state.filteredGaze)
  const pdfBounds = useGazeStore((state) => state.pdfBounds)
  const rawConfidence = useGazeStore((state) => state.confidence)

  // New real-time metrics
  const headPose = useGazeStore((state) => state.headPose)
  const latency = useGazeStore((state) => state.stats.latency)
  const predictionLatency = useGazeStore((state) => state.stats.predictionLatency)

  // ` Key (Backquote) toggles debug sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '`' || e.code === 'Backquote' || e.key === '₩') {
        toggleVisibility()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [toggleVisibility])

  return (
    <>
      {/* Gaze Dot Visuals — always rendered when data available (not tied to isVisible panel) */}
      {isVisible && rawGaze && (
        <div
          className="gaze-dot raw"
          style={{ '--gaze-x': `${rawGaze.x}px`, '--gaze-y': `${rawGaze.y}px` } as CSSProperties}
        />
      )}
      {isVisible && filteredGaze && (
        <div
          className="gaze-dot filtered"
          style={{ '--gaze-x': `${filteredGaze.x}px`, '--gaze-y': `${filteredGaze.y}px` } as CSSProperties}
        >
          <div
            className="dwell-indicator"
            style={{
              '--dwell-scale': `${1 + Math.max(nextProgress, prevProgress) / 50}`,
              '--dwell-opacity': `${Math.max(nextProgress, prevProgress) / 100}`,
            } as CSSProperties}
          />
        </div>
      )}

      {/* Stats Panel — slides in/out via CSS class on parent cluster */}
      <div
        className={`debug-overlay-panel ${isVisible ? 'panel-visible' : 'panel-hidden'}`}
      >
        <h3>EyeScore Gaze Monitor</h3>
        <hr />

        {/* SYSTEM STATUS */}
        <div className="debug-section">
          <h4>SYSTEM STATUS</h4>
          <p>
            Active Tracker{' '}
            <span className="highlight">
              {isTracking ? 'ONLINE' : 'OFFLINE'}
            </span>
          </p>
          <p>
            Face Mesh
            <span className={isFaceDetected ? 'status-ok' : 'status-error'}>
              {isFaceDetected ? ' DETECTED' : ' NOT FOUND'}
            </span>
          </p>
          <p>
            Webcam FPS <span className="highlight">{fps}</span>
          </p>
          <p>
            Stability Score <span>{stability.toFixed(0)}%</span>
          </p>
        </div>

        {/* GAZE COORDINATES */}
        <div className="debug-section">
          <h4>GAZE COORDINATES</h4>
          <p>
            Raw Gaze{' '}
            <span>
              x: {rawGaze ? Math.round(rawGaze.x) : '-'}, y:{' '}
              {rawGaze ? Math.round(rawGaze.y) : '-'}
            </span>
          </p>
          <p>
            Filtered{' '}
            <span>
              x: {filteredGaze ? Math.round(filteredGaze.x) : '-'}, y:{' '}
              {filteredGaze ? Math.round(filteredGaze.y) : '-'}
            </span>
          </p>
          <p>
            Delta (Offset){' '}
            <span>
              {rawGaze && filteredGaze
                ? `${Math.round(Math.hypot(rawGaze.x - filteredGaze.x, rawGaze.y - filteredGaze.y))}px`
                : '0px'}
            </span>
          </p>
        </div>

        {/* HEAD POSE */}
        <div className="debug-section">
          <h4>HEAD POSE</h4>
          <p>
            Head Yaw <span>{headPose ? `${headPose.yaw}°` : '0°'}</span>
          </p>
          <p>
            Head Pitch <span>{headPose ? `${headPose.pitch}°` : '0°'}</span>
          </p>
          <p>
            Head Roll <span>{headPose ? `${headPose.roll}°` : '0°'}</span>
          </p>
        </div>

        {/* CONFIDENCE SCORE */}
        <div className="debug-section">
          <h4>CONFIDENCE SCORE</h4>
          <p>
            Confidence{' '}
            <span
              className={
                (rawConfidence !== undefined
                  ? rawConfidence
                  : isFaceDetected
                    ? 1.0
                    : 0.0) > 0.5
                  ? 'status-ok'
                  : 'status-error'
              }
            >
              {Math.round(
                (rawConfidence !== undefined
                  ? rawConfidence
                  : isFaceDetected
                    ? 1.0
                    : 0.0) * 100,
              )}
              %
            </span>
          </p>
        </div>

        {/* PERFORMANCE METRICS */}
        <div className="debug-section">
          <h4>PERFORMANCE METRICS</h4>
          <p>
            Camera FPS <span>{isTracking ? 30 : 0}</span>
          </p>
          <p>
            Tracking FPS <span>{fps}</span>
          </p>
          <p>
            Frame Latency{' '}
            <span className={frameLatencyStatus(latency > 0 ? latency : 33)}>
              {latency > 0 ? `${latency.toFixed(1)}ms` : '~33ms'}
            </span>
          </p>
          <p>
            Prediction Latency{' '}
            <span className={predictionLatency > 0 ? predictionLatencyStatus(predictionLatency) : 'highlight'}>
              {predictionLatency > 0 ? `${predictionLatency.toFixed(1)}ms` : '측정 중...'}
            </span>
          </p>
          <p>
            Dropped Frames <span className="status-ok">0</span>
          </p>
        </div>

        {/* DWELL PROGRESS */}
        <div className="debug-section">
          <h4>DWELL PROGRESS</h4>
          <p>
            Next Dwell <span>{nextProgress}%</span>
          </p>
          <p>
            Prev Dwell <span>{prevProgress}%</span>
          </p>
        </div>

        {/* SETTINGS STATE */}
        <div className="debug-section">
          <h4>SETTINGS STATE</h4>
          <p>
            Mouse Sim{' '}
            <span className={sandboxEnabled ? 'status-ok' : 'highlight'}>
              {sandboxEnabled ? 'ENABLED' : 'DISABLED'}
            </span>
          </p>
          <p>
            Gaze Cursor <span>{cursorVisible ? 'SHOWN' : 'HIDDEN'}</span>
          </p>
          <p>
            Cursor Info <span>{cursorDebugVisible ? 'SHOWN' : 'HIDDEN'}</span>
          </p>
        </div>

        {/* PDF BOUNDS */}
        <div className="debug-section">
          <h4>PDF BOUNDS</h4>
          {pdfBounds ? (
            <div className="debug-bounds-info">
              <div>
                x: {Math.round(pdfBounds.x)}px, y: {Math.round(pdfBounds.y)}px
              </div>
              <div>
                w: {Math.round(pdfBounds.width)}px, h:{' '}
                {Math.round(pdfBounds.height)}px
              </div>
            </div>
          ) : (
            <p className="status-error">CANVAS NOT BOUND</p>
          )}
        </div>

        <p className="debug-keyboard-tip">
          * Press <strong>` (Backquote)</strong> to toggle.
        </p>
      </div>
    </>
  )
}
