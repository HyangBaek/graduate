// src/presentation/hooks/useFrameLoop.ts

import {
  useCallback,
  useEffect,
  useRef,
} from 'react'

/**
 * 매 프레임 콜백에 전달되는 타이밍 정보.
 * @property now requestAnimationFrame이 제공하는 현재 타임스탬프
 * @property deltaTime 이전 프레임과의 시간 차(ms), maxDeltaTime으로 클램프됨
 * @property elapsedTime 루프 시작 이후 누적 경과 시간(ms)
 * @property fps 이번 프레임의 실측 fps(1000/deltaTime)
 * @property frame 루프 시작 이후 콜백이 호출된 누적 프레임 번호
 */
export interface FrameLoopInfo {
  now: number
  deltaTime: number
  elapsedTime: number
  fps: number
  frame: number
}

/**
 * useFrameLoop이 매 프레임마다 호출하는 콜백 타입.
 */
export type FrameLoopCallback = (
  info: FrameLoopInfo,
) => void

/**
 * useFrameLoop 훅의 동작을 조정하는 옵션.
 */
export interface UseFrameLoopOptions {
  enabled?: boolean

  /*
   * target fps
   */
  fps?: number

  /*
   * browser inactive tab 복귀 시
   * delta 폭주 방지 제한
   */
  maxDeltaTime?: number

  /*
   * visibility hidden tab pause 여부
   */
  pauseWhenHidden?: boolean

  /*
   * FPS 유지 위해
   * frame skip 허용 여부
   */
  allowFrameSkip?: boolean
}

/**
 * useFrameLoop 훅이 반환하는 제어 함수 모음.
 * @property start 루프를 시작한다 (이미 실행 중이면 무시)
 * @property stop 루프를 정지한다
 * @property isRunning 현재 루프가 실행 중인지 여부를 반환한다
 */
export interface UseFrameLoopReturn {
  start: () => void

  stop: () => void

  isRunning: () => boolean
}

const DEFAULT_OPTIONS: Required<UseFrameLoopOptions> = {
  enabled: true,

  fps: 30,

  maxDeltaTime: 100,

  pauseWhenHidden: true,

  allowFrameSkip: true,
}

/**
 * requestAnimationFrame 기반의 범용 프레임 루프 훅.
 * 목표 fps에 맞춰 콜백 호출 빈도를 제한하고(frame skip 지원),
 * 탭이 백그라운드로 전환되면 일시 정지했다가 복귀 시 delta 폭주를
 * 방지하도록 시간을 재보정하며, deltaTime을 maxDeltaTime으로 클램프해
 * 탭 비활성 복귀 시 한 번에 큰 deltaTime이 전달되는 것을 막는다.
 *
 * @param callback 매 프레임(목표 fps 간격으로) 호출되는 콜백
 * @param options enabled, fps, maxDeltaTime, pauseWhenHidden, allowFrameSkip 등 옵션
 * @returns start/stop/isRunning 제어 함수를 담은 객체
 */
export const useFrameLoop = (
  callback: FrameLoopCallback,
  options?: UseFrameLoopOptions,
): UseFrameLoopReturn => {
  /*
   * 최신 callback 유지
   */
  const callbackRef =
    useRef<FrameLoopCallback>(callback)

  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  /*
   * options ref
   *
   * render 중 ref 수정 금지 대응
   */
  const optionsRef = useRef<
    Required<UseFrameLoopOptions>
  >({
    ...DEFAULT_OPTIONS,
    ...options,
  })

  useEffect(() => {
    optionsRef.current = {
      ...DEFAULT_OPTIONS,
      ...options,
    }
  }, [options])

  /*
   * RAF 상태 refs
   */
  const rafIdRef = useRef<number | null>(null)

  const runningRef = useRef(false)

  const frameRef = useRef(0)

  const startTimeRef = useRef(0)

  const previousTimeRef = useRef(0)

  const accumulatorRef = useRef(0)

  /*
   * RAF loop function
   *
   * useCallback 사용 안 함
   * self-reference 문제 제거
   */
  function loop(now: number) {
    if (!runningRef.current) {
      return
    }

    const opts = optionsRef.current

    /*
     * hidden tab pause
     */
    if (
      opts.pauseWhenHidden &&
      document.hidden
    ) {
      previousTimeRef.current = now

      rafIdRef.current =
        requestAnimationFrame(loop)

      return
    }

    /*
     * init
     */
    if (startTimeRef.current === 0) {
      startTimeRef.current = now
    }

    if (previousTimeRef.current === 0) {
      previousTimeRef.current = now
    }

    /*
     * delta 계산
     */
    let deltaTime =
      now - previousTimeRef.current

    /*
     * inactive tab 복귀 보호
     * delta 폭주 방지
     */
    deltaTime = Math.min(
      deltaTime,
      opts.maxDeltaTime,
    )

    previousTimeRef.current = now

    /*
     * target fps interval
     */
    const frameInterval =
      1000 / opts.fps

    accumulatorRef.current += deltaTime

    /*
     * FPS 제한
     */
    if (
      accumulatorRef.current <
      frameInterval
    ) {
      rafIdRef.current =
        requestAnimationFrame(loop)

      return
    }

    /*
     * frame skip
     */
    if (opts.allowFrameSkip) {
      accumulatorRef.current =
        accumulatorRef.current %
        frameInterval
    } else {
      accumulatorRef.current = 0
    }

    frameRef.current += 1

    const elapsedTime =
      now - startTimeRef.current

    /*
     * 실측 fps
     */
    const fps =
      deltaTime > 0
        ? 1000 / deltaTime
        : 0

    callbackRef.current({
      now,

      deltaTime,

      elapsedTime,

      fps,

      frame: frameRef.current,
    })

    rafIdRef.current =
      requestAnimationFrame(loop)
  }

  /*
   * RAF cancel
   */
  const cancelLoop = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(
        rafIdRef.current,
      )

      rafIdRef.current = null
    }
  }, [])

  /*
   * start
   */
  const start = useCallback(() => {
    /*
     * StrictMode 중복 실행 방지
     */
    if (runningRef.current) {
      return
    }

    runningRef.current = true

    frameRef.current = 0

    accumulatorRef.current = 0

    startTimeRef.current = 0

    previousTimeRef.current = 0

    rafIdRef.current =
      requestAnimationFrame(loop)
  }, [])

  /*
   * stop
   */
  const stop = useCallback(() => {
    runningRef.current = false

    cancelLoop()
  }, [cancelLoop])

  /*
   * auto start
   */
  useEffect(() => {
    if (!optionsRef.current.enabled) {
      return
    }

    start()

    return () => {
      stop()
    }
  }, [start, stop])

  /*
   * visibility restore 안정화
   */
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        previousTimeRef.current =
          performance.now()
      }
    }

    document.addEventListener(
      'visibilitychange',
      handleVisibilityChange,
    )

    return () => {
      document.removeEventListener(
        'visibilitychange',
        handleVisibilityChange,
      )
    }
  }, [])

  return {
    start,

    stop,

    isRunning: () => runningRef.current,
  }
}
