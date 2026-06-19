// src/presentation/components/gaze/CameraGazeWarningOverlay.tsx
import { useEffect, useState } from 'react'
import { useGazeStore } from '@/presentation/state/gazeStore'
import { useCalibrationStore } from '@/presentation/store/calibrationStore'
import { useDebugStore } from '@/presentation/store/useDebugStore'
import { useAppRouter } from '@/app/router/useAppRouter'
import '@/presentation/styles/components/CameraGazeWarningOverlay.css'

/**
 * 시선 추적 상태 및 headpose, 그리고 화면 가장자리 클랩프(벽타기)를 감지하여
 * 1. 카메라 응시 유도 경고 (레드 계열, 무제한)
 * 2. 캘리브레이션 재배치 권장 경고 (오렌지 계열, 세션 내 최대 5회 제한)
 * 를 적절히 표시해주는 전역 경고 오버레이.
 */
export function CameraGazeWarningOverlay() {
  const currentPage = useAppRouter((s) => s.currentPage)
  const isTracking = useGazeStore((s) => s.isTracking)
  const isFaceDetected = useGazeStore((s) => s.isFaceDetected)
  const gaze = useGazeStore((s) => s.filteredGaze)
  const headPose = useGazeStore((s) => s.headPose)
  const isCursorClamped = useGazeStore((s) => s.isCursorClamped)
  const isCalibrating = useCalibrationStore((s) => s.isCalibrating)
  const sandboxEnabled = useDebugStore((s) => s.sandboxEnabled)

  const [showFaceWarning, setShowFaceWarning] = useState(false)
  const [showRecalibrateWarning, setShowRecalibrateWarning] = useState(false)
  const [recalibrateWarningCount, setRecalibrateWarningCount] = useState(0)

  // 뷰어 및 디버그 화면에서만 감지 활성
  const activeWarningPage = currentPage === 'viewer' || currentPage === 'debug'
  const shouldCheck = activeWarningPage && isTracking && !isCalibrating && !sandboxEnabled

  // 1. 카메라 미응시/얼굴이탈 감지 (레드 경고)
  const isGazeLostNow = shouldCheck && (
    !isFaceDetected ||
    !gaze ||
    (headPose && (Math.abs(headPose.yaw) > 24 || Math.abs(headPose.pitch) > 20))
  )

  useEffect(() => {
    if (isGazeLostNow) {
      // 700ms 지속 시 표시
      const timer = setTimeout(() => {
        setShowFaceWarning(true)
      }, 700)
      return () => clearTimeout(timer)
    } else {
      setShowFaceWarning(false)
    }
  }, [isGazeLostNow])

  // 2. 시선이 화면 벽(가장자리)을 계속 타고 있음 = 보정이 틀어짐 감지 (오렌지 경고)
  // 카메라 이탈(레드) 상황이 아니고, 화면 가장자리에 3.5초 동안 연속 클램프된 경우
  const isStuckOnWall = shouldCheck && !isGazeLostNow && isCursorClamped

  useEffect(() => {
    if (isStuckOnWall) {
      const timer = setTimeout(() => {
        if (recalibrateWarningCount < 5) {
          setShowRecalibrateWarning(true)
          setRecalibrateWarningCount((prev) => prev + 1)
          console.log(`[CameraGazeWarningOverlay] Recalibrate warning triggered (${recalibrateWarningCount + 1}/5)`)
        }
      }, 3500)
      return () => clearTimeout(timer)
    } else {
      setShowRecalibrateWarning(false)
    }
  }, [isStuckOnWall, recalibrateWarningCount])

  // 캘리브레이션이 새로 시작되면 오렌지 경고 횟수 제한 카운트를 리셋해줍니다.
  useEffect(() => {
    if (isCalibrating) {
      setRecalibrateWarningCount(0)
      setShowRecalibrateWarning(false)
    }
  }, [isCalibrating])

  // 레드 경고(카메라 미응시)를 우선적으로 표시
  if (showFaceWarning) {
    return (
      <div className="camera-warning-overlay">
        <div className="camera-warning-content text-red">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="warning-icon"
          >
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          <span>카메라를 응시해주세요</span>
        </div>
      </div>
    )
  }

  // 오렌지 경고 (캘리브레이션 유도) 표시
  if (showRecalibrateWarning) {
    return (
      <div className="camera-warning-overlay">
        <div className="camera-warning-content text-orange">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="warning-icon"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>캘리브레이션을 다시 진행해주세요</span>
        </div>
      </div>
    )
  }

  return null
}
export default CameraGazeWarningOverlay
