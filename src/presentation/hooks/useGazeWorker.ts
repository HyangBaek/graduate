// src/presentation/hooks/useGazeWorker.ts
console.log(
  '[Worker] boot',
)
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'

import type {
  GazeWorkerInput,
  GazeWorkerOutput,
} from '@/workers/types/worker.types'

import GazePipelineWorker from '@/workers/gazePipeline.worker?worker'
import { useGazeStore } from '../state/gazeStore'

/**
 * useGazeWorker 훅에 전달하는 옵션.
 * @property onResult 워커로부터 정상 파이프라인 결과를 받을 때마다 호출되는 콜백
 * @property onError 워커에서 에러가 발생했을 때 호출되는 콜백
 */
export interface UseGazeWorkerOptions {
  onResult?: (data: GazeWorkerOutput) => void
  onError?: (error: ErrorEvent) => void
}

/**
 * useGazeWorker 훅이 반환하는 제어 함수 및 상태.
 * @property process 워커에 새 입력(카메라 프레임 등)을 전달해 처리를 요청한다
 * @property terminate 워커를 즉시 종료한다
 * @property isReady 워커가 INIT_ACK를 받아 처리 가능한 상태인지 여부
 * @property sendCommand 워커에 임의의 커맨드(예: RESET_BASELINE)를 전송한다
 */
export interface UseGazeWorkerReturn {
  process: (input: GazeWorkerInput) => void
  terminate: () => void
  isReady: boolean
  sendCommand: (cmd: object) => void
}

/**
 * worker lifecycle:
 * idle → initializing → ready → running → terminated
 */
/**
 * 시선 추정 파이프라인을 처리하는 Web Worker(gazePipeline.worker)를
 * 생성하고 생명주기를 관리하는 훅. INIT/INIT_ACK 핸드셰이크로 준비 상태를
 * 확인하고, 워커가 보내는 raw/filtered/uncalibrated 시선 결과를 화면
 * 범위로 클램프한 뒤 전역 gazeStore에 반영한다.
 *
 * @param options onResult/onError 콜백을 담은 옵션
 * @returns process/terminate/isReady/sendCommand를 담은 객체
 */
export const useGazeWorker = (
  options?: UseGazeWorkerOptions,
): UseGazeWorkerReturn => {
  /**
   * latest callbacks (stale closure 방지)
   */
  const onResultRef = useRef(options?.onResult)

  const onErrorRef = useRef(options?.onError)

  useEffect(() => {
    onResultRef.current = options?.onResult
  }, [options?.onResult])

  useEffect(() => {
    onErrorRef.current = options?.onError
  }, [options?.onError])

  /**
   * worker instance
   */
  const workerRef = useRef<Worker | null>(null)

  /**
   * fast runtime readiness (frame loop용)
   */
  const workerReadyRef = useRef(false)
  
  /**
   * mounted guard (StrictMode 대응)
   */
  const mountedRef = useRef(false)
  
  const workerIdRef = useRef(0)

  /**
   * true readiness (React sync)
   */
  const [isReady, setIsReady] = useState(false)

  

  

  /**
   * initialize worker + handshake
   */
  useEffect(() => {
    mountedRef.current = true

    workerIdRef.current += 1

    const workerId =
      workerIdRef.current

    console.log(
      `[Worker ${workerId}] create`,
    )

    const worker = new GazePipelineWorker()

    workerRef.current = worker
      
    /**
     * handshake 기반 ready 처리
     * worker 내부에서 INIT_ACK를 보내야 한다
     */
    worker.onmessage = (
      event,
    ) => {
      console.log(
        `[Worker ${workerId}] message type:`,
        (event.data as any)?.type ?? '(GazeWorkerOutput)',
      )

      // 기존 gaze 처리
      const data = event.data

      /**
       * INIT ACK
       */
      if (data?.type === 'INIT_ACK') {
        console.log(
            `[Worker ${workerId}] INIT_ACK received`,
        )
	
        workerReadyRef.current = true
	
        setIsReady(true)


        return
      }

      /**
       * normal pipeline result
       */
      const result = data as GazeWorkerOutput
      
      // console.log('[Worker Result]', result)
      
      const store = useGazeStore.getState()

      // 워커가 계산한 좌표가 화면 밖으로 나가는 경우(추정 오차, 경계 부근 노이즈
      // 등)를 방지하기 위해 raw/filtered/uncalibrated 모두 [0, innerWidth/innerHeight]
      // 범위로 클램프해서 store에 반영한다.
      if (result.raw) {
        store.setRawGaze({
          ...result.raw,
          x: Math.min(Math.max(result.raw.x, 0), window.innerWidth),
          y: Math.min(Math.max(result.raw.y, 0), window.innerHeight),
          confidence: 1,
        })
      } else {
        store.setRawGaze(null)
      }

      if (result.filtered) {
        store.setFilteredGaze({
          ...result.filtered,
          x: Math.min(Math.max(result.filtered.x, 0), window.innerWidth),
          y: Math.min(Math.max(result.filtered.y, 0), window.innerHeight),
        })
        store.setStability(result.filtered.stabilityScore ?? 0)
      } else {
        store.setFilteredGaze(null)
        store.setStability(0)
      }

      if (result.uncalibrated) {
        store.setUncalibratedGaze({
          ...result.uncalibrated,
          x: Math.min(Math.max(result.uncalibrated.x, 0), window.innerWidth),
          y: Math.min(Math.max(result.uncalibrated.y, 0), window.innerHeight),
        })
      } else {
        store.setUncalibratedGaze(null)
      }

      store.setFPS(result.fps)

      store.setDwellProgress(result.nextProgress, result.prevProgress)
      store.setNavigationTriggers(
        result.shouldNavigateNext,
        result.shouldNavigatePrev,
      )

      store.setHeadPose(result.headPose ?? null)

      if (result.baselineX !== undefined && result.baselineY !== undefined) {
        store.setBaselineCoords(result.baselineX, result.baselineY)
      }

      // Calculate and update latency
      const filteredTimestamp = result.filtered?.timestamp ?? performance.now()
      const latency = performance.now() - filteredTimestamp
      store.updateStats({ latency })

      store.setIsTracking(true)

      /*
       * external callback
       */
      onResultRef.current?.(result)
    }

    /**
     * error handler
     */
    worker.onerror = (error: ErrorEvent) => {
      console.error(
        `[Worker ${workerId}] error`,
        error,
      )

      onErrorRef.current?.(error)
    }

    console.log(
      `[Worker ${workerId}] send INIT`,
    )

    /**
     * INIT handshake trigger
     */
    worker.postMessage({ type: 'INIT' })
    
    return () => {
      console.log(
        `[Worker ${workerId}] cleanup`,
      )
      mountedRef.current = false

      workerReadyRef.current = false
      
      setIsReady(false)

      worker.terminate()

      workerRef.current = null
    }
  }, [])

  console.log(
    '[GazeRuntime] before process',
  )
  /**
   * process input (frame loop entry)
   */
  const process = useCallback(
    (input: GazeWorkerInput) => {
      // console.log('[process called]')
      const worker = workerRef.current

      if (!worker) {
        console.warn('[process] worker missing')
        return
      }

      /**
       * fast-path readiness check (frame loop safety)
       */
      if (!worker || !workerReadyRef.current) {
        console.warn('[process] worker not ready', )
        return
      }

      // console.log('[process] postMessage')
      worker.postMessage(input, )
    },
    [],
  )

  /**
   * terminate worker
   */
  const terminate = useCallback(() => {
    const worker = workerRef.current

    console.log(
      '[terminate]',
      worker,
      workerReadyRef.current,
    )
    if (!worker) return

    worker.terminate()

    workerRef.current = null
    workerReadyRef.current = false
    setIsReady(false)
  }, [])

  /**
   * send arbitrary command to worker (e.g. RESET_BASELINE)
   */
  const sendCommand = useCallback((cmd: object) => {
    const worker = workerRef.current
    if (!worker || !workerReadyRef.current) return
    worker.postMessage(cmd)
  }, [])

  return {
    process,
    terminate,
    isReady,
    sendCommand,
  }
}
