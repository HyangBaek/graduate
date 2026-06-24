// src/presentation/hooks/useFaceTracking.ts

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import type { FaceLandmark } from '@/domain/models/FaceLandmark'
import type {
  FaceTrackerConfig,
  FaceTrackerStatus,
} from '@/domain/interfaces/FaceTracker'

import { FaceMeshWorkerAdapter as FaceMeshAdapter } from '@/infrastructure/mediapipe/FaceMeshWorkerAdapter'
import { useFrameLoop } from '@/presentation/hooks/useFrameLoop'

/**
 * useFaceTracking 훅에 전달하는 옵션.
 */
export interface UseFaceTrackingOptions {
  /*
   * auto tracking start
   */
  autoStart?: boolean

  /*
   * tracking FPS
   *
   * FaceMeshAdapter targetFPS와
   * 동일하게 맞추는 것을 권장
   */
  fps?: number

  /*
   * tracker config
   */
  config?: FaceTrackerConfig
}

/**
 * useFaceTracking 훅이 반환하는 상태 및 제어 함수 모음.
 */
export interface UseFaceTrackingReturn {
  /*
   * tracker status
   */
  status: FaceTrackerStatus

  /*
   * running 여부
   */
  isTracking: boolean

  /*
   * face detected 여부
   */
  isFaceDetected: boolean

  /*
   * latest landmarks
   */
  landmarks: FaceLandmark[]

  /*
   * latest error
   */
  error: Error | null

  /*
   * tracking start
   */
  start: (
    video: HTMLVideoElement,
    onFrame?: (l: FaceLandmark[]) => void,
  ) => Promise<void>

  /*
   * tracking stop
   */
  stop: () => void

  /*
   * destroy resources
   */
  destroy: () => Promise<void>

  /*
   * onFrame 콜백 갱신 (start 재호출 없이 최신 핸들러 교체)
   */
  updateOnFrame: (fn: ((l: FaceLandmark[]) => void) | null) => void
}

/**
 * FaceMeshAdapter(MediaPipe Face Mesh 워커 어댑터)를 감싸 얼굴 추적
 * 시작/중지/파기와 추적 상태(status/isFaceDetected/landmarks/error)를
 * React 상태로 노출하는 훅. useFrameLoop을 이용해 지정한 fps로 매 프레임
 * tracker.detect()를 호출(pull 방식)하고 결과를 상태에 반영한다.
 *
 * @param options autoStart, fps, config 등 추적 동작을 조정하는 옵션
 * @returns status/isTracking/isFaceDetected/landmarks/error 상태와
 *          start/stop/destroy/updateOnFrame 제어 함수를 담은 객체
 */
export const useFaceTracking = (
  options: UseFaceTrackingOptions = {},
): UseFaceTrackingReturn => {
  const {
    config,
    fps = 30,
  } = options

  /*
   * tracker instance singleton per hook
   */
  const trackerRef = useRef<FaceMeshAdapter | null>(null)

  /*
   * mounted guard
   */
  const mountedRef = useRef(true)

  /*
   * current video source
   */
  const videoRef = useRef<HTMLVideoElement | null>(null)

  /*
   * tracking state
   */
  const [status, setStatus] =
    useState<FaceTrackerStatus>('idle')

  const [isFaceDetected, setIsFaceDetected] =
    useState(false)

  const [landmarks, setLandmarks] =
    useState<FaceLandmark[]>([])

  const [error, setError] =
    useState<Error | null>(null)

  /*
   * tracker lazy initialize
   *
   * render phase 접근 금지
   */
  const stableConfig = useMemo(
    () => ({
      targetFPS: fps,
      maxFaces: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
      debug: false,
      ...config,
    }),
    [config, fps],
  )

  /*
   * tracker lazy creation
   */
  const getTracker = useCallback(() => {
    if (!trackerRef.current) {
      trackerRef.current = new FaceMeshAdapter(stableConfig)
    }
    return trackerRef.current
  }, [stableConfig])

  const onFrameRef = useRef<((l: FaceLandmark[]) => void) | null>(null)

  // onFrame 콜백이 변경될 때마다 ref 동기화 (handleFrame이 재생성되는 경우 대비)
  // start()가 다시 호출되지 않아도 최신 콜백이 항상 사용됨
  const updateOnFrame = useCallback((fn: ((l: FaceLandmark[]) => void) | null) => {
    onFrameRef.current = fn
  }, [])

  /*
   * tracking loop (pull 방식)
   */
  useFrameLoop(
    () => {
      const tracker = trackerRef.current
      if (!tracker) return

      if (tracker.getStatus() !== 'running') return

      const result = tracker.detect()

      if (!result) return

      setStatus(tracker.getStatus())
      setIsFaceDetected(result.isFaceDetected)
      setLandmarks(result.landmarks)
      onFrameRef.current?.(result.landmarks)
    },
    {
      enabled: true,
      fps,
      pauseWhenHidden: true,
      allowFrameSkip: true,
    },
  )

  /*
   * tracking start
   */
  const start = useCallback(
  async (
    video: HTMLVideoElement,
    onFrame?: (
      l: FaceLandmark[],
    ) => void,
  ) => {
      try {
        setError(null)

        const tracker = getTracker()
        videoRef.current = video

        onFrameRef.current = onFrame ?? null

        /*
         * initialize
         */
        if (tracker.getStatus() === 'idle') {
          await tracker.initialize()
        }

        /*
         * start tracking
         */
        await tracker.start(video)

        if (!mountedRef.current) return

        setStatus(tracker.getStatus())
      } catch (err) {
        const nextError =
          err instanceof Error
            ? err
            : new Error('Failed to start face tracking')

        setError(nextError)
        setStatus('error')
      }
    },
    [getTracker],
  )

  /*
   * tracking stop
   */
  const stop = useCallback(() => {
    const tracker = trackerRef.current
    if (!tracker) return

    tracker.stop()

    setStatus(tracker.getStatus())
    setIsFaceDetected(false)
  }, [])

  /*
   * destroy tracker
   */
  const destroy = useCallback(async () => {
    const tracker = trackerRef.current
    if (!tracker) return

    await tracker.destroy()

    trackerRef.current = null
    videoRef.current = null

    setStatus('idle')
    setLandmarks([])
    setIsFaceDetected(false)
    setError(null)
  }, [])

  /*
   * lifecycle
   */
  useEffect(() => {
    mountedRef.current = true

    /*
     * FaceMeshAdapter 내부 onTracking을
     * 여기서 state로 연결해야 한다면
     * adapter에서 직접 set하는 구조로 가야 함
     *
     * (현재는 detect 기반 구조라 생략)
     */

    return () => {
      mountedRef.current = false
      void destroy()
    }
  }, [destroy])

  return {
    status,
    isTracking: status === 'running',
    isFaceDetected,
    landmarks,
    error,
    start,
    stop,
    destroy,
    updateOnFrame,
  }
}
