// src/presentation/hooks/useGazeTracking.ts

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
// import { useShallow } from 'zustand/shallow'

import type { FaceLandmark } from '@domain/models/FaceLandmark'
import type { ProcessedGazeResult } from '@domain/types/ProcessedGazeResult'
import type { GazeTrackingStatus } from '@domain/types/GazeTrackingStatus'

import { useGazeStore } from '@/presentation/state/gazeStore'
import { useCalibrationStore } from '@/presentation/store/calibrationStore'
import { GazeEstimatorAdapter } from '@/infrastructure/webeyetrack/GazeEstimatorAdapter'
import { FaceMeshAdapter } from '@infrastructure/mediapipe/FaceMeshAdapter'
import { ProcessGazeUseCase } from '@domain/usecases/ProcessGazeUseCase'
import { GazeFilterService } from '@domain/services/GazeFilterService'
import { StabilityService } from '@domain/services/StabilityService'

export interface UseGazeTrackingOptions {
  enabled?: boolean
  debug?: boolean

  onProcessed?: (result: ProcessedGazeResult) => void
  onError?: (error: Error) => void
}

/*
 * usecase factory (singleton pattern)
 */
const createProcessGazeUseCase = () => {
  return new ProcessGazeUseCase(
    new GazeEstimatorAdapter(),
    new GazeFilterService(),
    new StabilityService(),
  )
}

export interface UseGazeTrackingReturn {
  isTracking: boolean
  isInitializing: boolean
  status: GazeTrackingStatus
  error: string | null

  startTracking: (video: HTMLVideoElement) => Promise<void>
  stopTracking: () => void
}

export function useGazeTracking(
  options: UseGazeTrackingOptions,
): UseGazeTrackingReturn {
  const {
    enabled = true,
    debug = false,
    onProcessed,
    onError,
  } = options

  /*
   * calibration state
   */
  const calibrationData =
    useCalibrationStore(state => state.calibrationData)

  /*
   * store actions
   */
  const {
    setRawGaze,
    setFilteredGaze,
    setConfidence,
    setFPS,
    setIsTracking,
  } = useGazeStore()

  /*
   * refs (single responsibility)
   */
  const trackerRef = useRef<FaceMeshAdapter | null>(null)
  const useCaseRef = useRef<ProcessGazeUseCase | null>(null)

  const isRunningRef = useRef(false)
  const frameCountRef = useRef(0)
  const fpsStartRef = useRef(0)

  const mountedRef = useRef(false)

  /*
   * local state
   */
  const [status, setStatus] = useState<GazeTrackingStatus>('idle')
  const [isTracking, setTracking] = useState(false)
  const [isInitializing, setIsInitializing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /*
   * init once
   */
  useEffect(() => {
    mountedRef.current = true

    trackerRef.current = new FaceMeshAdapter()
    useCaseRef.current = createProcessGazeUseCase()

    fpsStartRef.current = performance.now()

    return () => {
      mountedRef.current = false

      trackerRef.current?.destroy?.()
      trackerRef.current = null

      useCaseRef.current = null
    }
  }, [])

  /*
   * FPS counter
   */
  const updateFPS = useCallback(() => {
    frameCountRef.current += 1

    const now = performance.now()
    const elapsed = now - fpsStartRef.current

    if (elapsed < 1000) return

    const fps = Math.round(
      (frameCountRef.current * 1000) / elapsed,
    )

    setFPS(fps)

    frameCountRef.current = 0
    fpsStartRef.current = now
  }, [setFPS])

  /*
   * landmark handler
   */
  const handleTracking = useCallback(
    (landmarks: FaceLandmark[]) => {
      if (!enabled) return

      const landmark = landmarks[0]
      if (!landmark) return

      const useCase = useCaseRef.current
      if (!useCase) return

      try {
        const result = useCase.execute(landmark, {
          calibrationData,
          screenWidth: window.innerWidth,
          screenHeight: window.innerHeight,
        })

        if (!result) return

        /*
         * store 업데이트
         */
        setRawGaze({
          ...result.raw,
          confidence: result.confidence,
        })

        setFilteredGaze(result.filtered)
        setConfidence(result.confidence)

        updateFPS()

        onProcessed?.(result)

        if (debug) {
          console.log('[useGazeTracking]', result)
        }
      } catch (err) {
        const error =
          err instanceof Error
            ? err
            : new Error('Failed to process gaze')

        setError(error.message)
        onError?.(error)
      }
    },
    [
      enabled,
      calibrationData,
      setRawGaze,
      setFilteredGaze,
      setConfidence,
      updateFPS,
      onProcessed,
      onError,
      debug,
    ],
  )

  /*
   * tracking 시작
   */
  const startTracking = useCallback(
    async (video: HTMLVideoElement) => {
      if (!mountedRef.current) return
      if (!enabled) return

      try {
        setError(null)
        setStatus('initializing')
        setIsInitializing(true)

        const tracker = trackerRef.current
        if (!tracker) return

        await tracker.initialize()

        tracker.onTracking((result) => {
          const trackerStatus = tracker.getStatus()
          const gazeStatus =
            trackerStatus === 'ready'
              ? 'running'
              : trackerStatus

          setStatus(gazeStatus)
          handleTracking(result.landmarks)
        })

        tracker.onError((err) => {
          const error =
            err instanceof Error
              ? err
              : new Error('tracker error')

          setError(error.message)
          onError?.(error)
        })

        await tracker.start(video)

        setStatus('running')
        setTracking(true)
        setIsTracking(true)
      } catch (err) {
        const error =
          err instanceof Error
            ? err
            : new Error('Failed to start tracking')

        setError(error.message)
        setStatus('error')
        onError?.(error)
      } finally {
        setIsInitializing(false)
      }
    },
    [enabled, handleTracking, onError, setIsTracking],
  )

  /*
   * stop tracking
   */
  const stopTracking = useCallback(() => {
    isRunningRef.current = false

    trackerRef.current?.stop()

    setTracking(false)
    setIsTracking(false)
    setStatus('stopped')
  }, [setIsTracking])

  /*
   * unmount cleanup
   */
  useEffect(() => {
    return () => {
      stopTracking()
    }
  }, [stopTracking])

  return {
    isTracking,
    isInitializing,
    status,
    error,
    startTracking,
    stopTracking,
  }
}
