// src/presentation/components/debug/DebugSandbox.tsx

import React, { useEffect, useRef } from 'react'
import { useDebugStore } from '../../store/useDebugStore'
import { useGazeStore } from '../../state/gazeStore'
import '@/presentation/styles/components/DebugSandbox.css'

/**
 * 실제 카메라/시선 추적 없이 마우스 움직임을 시선(Gaze) 데이터처럼
 * 시뮬레이션하는 디버그용 샌드박스 패널.
 * 마우스 좌표를 Raw Gaze로 보고 EMA 필터를 적용해 Filtered Gaze를 만들고,
 * 오프셋/Dwell Progress/핫존 진입 여부 등을 계산해 디버그 스토어와
 * (sandboxEnabled인 경우) 전역 gazeStore에 동기화한다.
 *
 * @returns 샌드박스 안내 문구와 사용법 팁을 보여주는 패널 div
 */
export const DebugSandbox: React.FC = () => {
  const setDebugData = useDebugStore((state) => state.setDebugData)
  const isVisible = useDebugStore((state) => state.isVisible)
  const sandboxEnabled = useDebugStore((state) => state.sandboxEnabled)

  // 가상 Kalman/EMA 필터 및 Dwell 타이머를 위한 ref 설정
  const frameCountRef = useRef<number>(0)
  const fpsTimeRef = useRef<number>(0)

  const currentFilteredGaze = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const mousePos = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const dwellCounter = useRef<number>(0)

  useEffect(() => {
    fpsTimeRef.current = performance.now()

    // 1. 마우스 움직임을 웹캠 시각 추적 데이터(Raw Gaze)로 시뮬레이션
    const handleMouseMove = (e: MouseEvent) => {
      mousePos.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener('mousemove', handleMouseMove)

    // 2. 통합 디버그 루프 실행 (requestAnimationFrame)
    let animationFrameId: number

    const loop = (timestamp: number) => {
      // --- FPS 계산 모듈 ---
      frameCountRef.current += 1
      const elapsed = timestamp - fpsTimeRef.current
      if (elapsed >= 1000) {
        setDebugData({
          fps: Math.round((frameCountRef.current * 1000) / elapsed),
        })
        frameCountRef.current = 0
        fpsTimeRef.current = timestamp
      }

      // --- Face Detection 가상 시뮬레이션 ---
      const isFaceDetected = mousePos.current.x > 50

      // --- 가상 시선 추적 필터 알고리즘 (EMA Filter) ---
      const alpha = 0.15
      currentFilteredGaze.current = {
        x:
          currentFilteredGaze.current.x +
          alpha * (mousePos.current.x - currentFilteredGaze.current.x),
        y:
          currentFilteredGaze.current.y +
          alpha * (mousePos.current.y - currentFilteredGaze.current.y),
      }

      // --- Calibration Offset 시뮬레이션 ---
      const dx = mousePos.current.x - currentFilteredGaze.current.x
      const dy = mousePos.current.y - currentFilteredGaze.current.y
      const offset = Math.sqrt(dx * dx + dy * dy)

      // --- Dwell Progress (시선 머무름) 제어 루프 ---
      if (offset < 15 && isFaceDetected) {
        if (dwellCounter.current < 100) {
          dwellCounter.current += 2.0
        }
      } else {
        dwellCounter.current = Math.max(0, dwellCounter.current - 5)
      }

      // --- 전역 디버그 스토어 일괄 업데이트 ---
      setDebugData({
        rawGaze: mousePos.current,
        filteredGaze: currentFilteredGaze.current,
        isFaceDetected,
        calibrationOffset: offset,
        dwellProgress: Math.min(100, Math.floor(dwellCounter.current)),
      })

      // --- 만약 마우스 시뮬레이션(Sandbox)이 활성화되어 있다면, 전역 시선 데이터도 동기화 ---
      if (sandboxEnabled) {
        const store = useGazeStore.getState()
        store.setIsTracking(true)
        store.setCameraReady(true)
        store.setCameraResolution('Sandbox (1920x1080)')
        store.setFaceDetected(isFaceDetected)
        store.setLandmarkCount(isFaceDetected ? 478 : 0)

        store.setRawGaze({
          x: mousePos.current.x,
          y: mousePos.current.y,
          timestamp,
          confidence: isFaceDetected ? 1.0 : 0.0,
          isStable: offset < 15,
          stabilityScore: Math.round(100 - Math.min(100, offset * 2)),
        })
        store.setFilteredGaze({
          x: currentFilteredGaze.current.x,
          y: currentFilteredGaze.current.y,
          timestamp,
        })
        store.setStability(Math.round(100 - Math.min(100, offset * 2)))

        // Simulating head pose based on cursor position relative to screen center
        store.setHeadPose(
          isFaceDetected
            ? {
                yaw: Math.max(
                  -45,
                  Math.min(
                    45,
                    Math.round(
                      (mousePos.current.x - window.innerWidth / 2) / 20,
                    ),
                  ),
                ),
                pitch: Math.max(
                  -45,
                  Math.min(
                    45,
                    Math.round(
                      (window.innerHeight / 2 - mousePos.current.y) / 15,
                    ),
                  ),
                ),
                roll: Math.max(-10, Math.min(10, Math.round(dx / 10))),
              }
            : null,
        )

        // Simulating pipeline latency (higher offset = more lag)
        store.updateStats({
          latency: Math.max(1, Math.round(offset / 8)),
        })

        // 핫존 영역 검출
        const screenWidth = window.innerWidth
        const screenHeight = window.innerHeight
        const pdfBounds = useGazeStore.getState().pdfBounds
        const bounds = pdfBounds || {
          x: 0,
          y: 0,
          width: screenWidth,
          height: screenHeight,
        }

        const inNextZone =
          currentFilteredGaze.current.x >= bounds.x + bounds.width * 0.75 &&
          currentFilteredGaze.current.x <= bounds.x + bounds.width &&
          currentFilteredGaze.current.y >= bounds.y + bounds.height * 0.80 &&
          currentFilteredGaze.current.y <= bounds.y + bounds.height

        const inPrevZone =
          currentFilteredGaze.current.x >= bounds.x &&
          currentFilteredGaze.current.x <= bounds.x + bounds.width &&
          currentFilteredGaze.current.y >= bounds.y &&
          currentFilteredGaze.current.y <= bounds.y + bounds.height * 0.15

        let nextProg = 0
        let prevProg = 0

        if (isFaceDetected) {
          if (inNextZone) {
            nextProg = Math.min(100, Math.floor(dwellCounter.current))
          } else if (inPrevZone) {
            prevProg = Math.min(100, Math.floor(dwellCounter.current))
          }
        }
        useGazeStore.getState().setDwellProgress(nextProg, prevProg)

        if (dwellCounter.current >= 100) {
          if (inNextZone) {
            useGazeStore.getState().setNavigationTriggers(true, false)
          } else if (inPrevZone) {
            useGazeStore.getState().setNavigationTriggers(false, true)
          }
          dwellCounter.current = 0
        } else {
          useGazeStore.getState().setNavigationTriggers(false, false)
        }
      }

      animationFrameId = requestAnimationFrame(loop)
    }

    animationFrameId = requestAnimationFrame(loop)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      cancelAnimationFrame(animationFrameId)
    }
  }, [setDebugData, sandboxEnabled])

  // Panel is always mounted; visibility controlled by CSS class via parent cluster
  return (
    <div
      className={`debug-sandbox-panel ${isVisible ? 'panel-visible' : 'panel-hidden'}`}
    >
      <h2>Gaze Tracking Sandbox</h2>
      <p className="debug-sandbox-desc">
        {sandboxEnabled ? (
          <>
            마우스를 움직여
            <br />
            Raw(빨간)과 Filtered(초록)
            <br />
            데이터 시간차를 확인하세요.
          </>
        ) : (
          <>
            마우스 시뮬레이션 활성화
            <br />- 시뮬레이션 마우스 포인터가
            <br />
            &nbsp;&nbsp;시선 좌표로 동작합니다.
          </>
        )}
      </p>
      <p className="debug-sandbox-tip">
        * 마우스를 멈추면
        <br />
        &nbsp;&nbsp;<strong>Dwell Progress</strong>가 상승합니다.
      </p>
      <p className="debug-sandbox-tip">
        * 키보드의
        <br />
        &nbsp;&nbsp;<strong>` (Backquote)</strong> 키를 누르면
        <br />
        &nbsp;&nbsp;패널 전체가 토글됩니다.
      </p>
    </div>
  )
}
