// src/app/runtime/GazeRuntime.tsx

import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react'

import {
    useFaceTracking,
} from '@/presentation/hooks/useFaceTracking'

import {
    useGazeWorker,
} from '@/presentation/hooks/useGazeWorker'

import {
    useGazeStore,
} from '@/presentation/state/gazeStore'

import type {
    FaceLandmark,
} from '@/domain/models/FaceLandmark'

import type { CalibrationData } from '@/domain/models/CalibrationData'

import { useDebugStore } from '@/presentation/store/useDebugStore'
import { useCalibrationStore } from '@/presentation/store/calibrationStore'
import { useViewerStore } from '@/presentation/store/viewerStore'
import '@/presentation/styles/components/GazeRuntime.css'

/**
 * Runtime Status
 */
type RuntimeStatus =
    | 'idle'
    | 'initializing'
    | 'running'
    | 'error'

/**
 * Runtime Config
 *
 * production runtime tuning
 */
export interface GazeRuntimeConfig {
    trackingFPS?: number

    enableCameraPreview?: boolean

    debug?: boolean
}

const DEFAULT_CONFIG: Required<GazeRuntimeConfig> = {
    trackingFPS: 30,

    enableCameraPreview: true,

    debug: false,
}

/**
 * GazeRuntime
 *
 * responsibilities:
 * - webcam lifecycle
 * - mediapipe orchestration
 * - worker orchestration
 * - cleanup
 * - runtime status sync
 * - store bridge
 *
 * NON responsibilities:
 * - rendering cursor
 * - calibration UI
 * - navigation UI
 * - PDF rendering
 *
 * @param props.trackingFPS 얼굴/시선 추적 목표 프레임레이트 (기본값 30)
 * @param props.enableCameraPreview 웹캠 미리보기 video 엘리먼트를 화면에 노출할지 여부
 * @param props.debug 디버그 로그 출력 여부
 * @returns 웹캠 스트림을 표시하는 video 엘리먼트 (preview 비활성 시 CSS로 숨김)
 */
export function GazeRuntime(
    props: Partial<GazeRuntimeConfig>,
) {
    /*
     * config
     */
    const config = useMemo(
        () => ({
            ...DEFAULT_CONFIG,
            ...props,
        }),
        [props],
    )

    const calibrationData = useCalibrationStore(
        (state) => state.calibrationData,
    )

    const isCalibrating = useCalibrationStore(
        (state) => state.isCalibrating,
    )

    const currentPointIndex = useCalibrationStore(
        (state) => state.currentPointIndex,
    )

    // ref로 관리해서 handleFrame이 재생성되지 않도록 함
    // calibrationData / isCalibrating 변경 시 파이프라인 전체 재시작 방지
    const calibrationDataRef = useRef<CalibrationData | null>(calibrationData)
    const isCalibratingRef = useRef(isCalibrating)
    const currentPointIndexRef = useRef(currentPointIndex)

    useEffect(() => {
        calibrationDataRef.current = calibrationData
    }, [calibrationData])

    useEffect(() => {
        isCalibratingRef.current = isCalibrating
    }, [isCalibrating])

    useEffect(() => {
        currentPointIndexRef.current = currentPointIndex
    }, [currentPointIndex])

    /*
     * runtime status
     */
    const [, setStatus] =
        useState<RuntimeStatus>('idle')

    /*
     * refs
     */
    const videoRef =
        useRef<HTMLVideoElement | null>(
            null,
        )

    /**
    * active media stream
    */
    const streamRef =
        useRef<MediaStream | null>(
            null,
        )

    const mountedRef =
        useRef(false)



    /*
     * zustand actions
     */
    const setIsTracking =
        useGazeStore(
            (state) =>
                state.setIsTracking,
        )

    const setFaceDetected =
        useGazeStore(
            (state) =>
                state.setFaceDetected,
        )

    const setFPS =
        useGazeStore(
            (state) =>
                state.setFPS,
        )

    const setRawGaze =
        useGazeStore(
            (state) =>
                state.setRawGaze,
        )

    const setFilteredGaze =
        useGazeStore(
            (state) =>
                state.setFilteredGaze,
        )

    const setStability =
        useGazeStore(
            (state) =>
                state.setStability,
        )

    const setCameraReady =
        useGazeStore(
            (state) =>
                state.setCameraReady,
        )

    const setCameraResolution =
        useGazeStore(
            (state) =>
                state.setCameraResolution,
        )

    const setLandmarkCount =
        useGazeStore(
            (state) =>
                state.setLandmarkCount,
        )

    const setHeadPose =
        useGazeStore(
            (state) =>
                state.setHeadPose,
        )

    const setBaselineCoords =
        useGazeStore(
            (state) =>
                state.setBaselineCoords,
        )

    const setBaselineLocked =
        useGazeStore(
            (state) =>
                state.setBaselineLocked,
        )

    /*
     * face tracking
     */
    const {
        start,
        stop,
        destroy,
        updateOnFrame,
    } = useFaceTracking({
        fps: config.trackingFPS,
    })

    /*
     * worker
     */
    const {
        process,
        terminate,
        isReady,
        sendCommand,
    } = useGazeWorker({
        onResult: (result) => {
            if (!mountedRef.current) {
                return
            }

            /*
             * sync store
             */
            setFPS(result.fps)

            setRawGaze(result.raw)

            setFilteredGaze(
                result.filtered,
            )

            setStability(
                result.filtered?.stabilityScore ?? 0,
            )

            // Worker가 매 프레임 계산한 실제 irisBaseline 값을 gazeStore에 동기화.
            // 이전에는 이 동기화가 없어 gazeStore.baselineX/Y가 초기값(0.5)에 영구 고정되어 있었고,
            // useCalibration의 captureSample이 첫 포인트(중앙점) 캡처 직후 이 잘못된 0.5/0.5 값을
            // calibrationData.baselineX/Y에 저장 → Worker가 매 프레임 irisBaseline.setBaseline(0.5, 0.5)로
            // 강제 리셋+lock하여, 중앙점에서 막 학습된 사용자의 실제 기준점이 즉시 파괴되는 버그가 있었음.
            if (
                typeof result.baselineX === 'number' &&
                typeof result.baselineY === 'number'
            ) {
                setBaselineCoords(result.baselineX, result.baselineY)
            }

            setBaselineLocked(result.isBaselineLocked)

            if (config.debug) {
                console.log(
                    '[WorkerResult]',
                    result,
                )
            }
        },

        onError: (error) => {
            console.error(
                '[WorkerError]',
                error,
            )

            if (!mountedRef.current) {
                return
            }

            setStatus('error')
        },
    })

    const isReadyRef = useRef(isReady)
    useEffect(() => {
        isReadyRef.current = isReady
    }, [isReady])

    /*
     * frame callback
     */
    const handleFrame =
        useCallback(
            (
                faces: FaceLandmark[],
            ) => {
                if (!isReadyRef.current) {
                    return
                }

                // If mouse simulation (sandbox) is active, do not process webcam inputs to prevent coordinate conflicts
                const sandboxEnabled = useDebugStore.getState().sandboxEnabled
                if (sandboxEnabled) {
                    return
                }

                const primaryFace =
                    faces[0]

                /**
                 * no face
                 */
                if (!primaryFace) {
                    setFaceDetected(false)
                    setLandmarkCount(0)
                    setHeadPose(null)

                    return
                }

                setFaceDetected(true)
                setLandmarkCount(primaryFace.points.length)

                /**
                 * debug
                 */
                if (config.debug) {
                    console.log('[GazeRuntime] face detected', primaryFace,)

                    console.log('[LandmarkCount]', primaryFace.points.length,)
                }

                /**
                 * worker process
                 */
                const pdfBounds = useGazeStore.getState().pdfBounds
                const navigationPauseUntil = useGazeStore.getState().navigationPauseUntil
                const isNavigationPaused = navigationPauseUntil != null && Date.now() < navigationPauseUntil

                process({
                    landmarks:
                        primaryFace.points,

                    timestamp:
                        performance.now(),

                    screen: {
                        width:
                            window.innerWidth,

                        height:
                            window.innerHeight,
                    },

                    dwellRegion: {
                        type: 'rect',

                        left: 0,
                        top: 0,

                        right:
                            window.innerWidth,

                        bottom:
                            window.innerHeight,
                    },

                    calibrationData: calibrationDataRef.current,
                    isCalibrating: isCalibratingRef.current,
                    currentPointIndex: currentPointIndexRef.current,
                    pdfBounds,
                    isNavigationPaused,
                })
            },
            [
                config.debug,
                process,
                setFaceDetected,
                // calibrationData와 isCalibrating은 ref로 읽으므로 deps에서 제거
                // → handleFrame이 안정적(stable)으로 유지됨 → 파이프라인 재시작 없음
            ],
        )

    // handleFrame이 혹시라도 변경될 때 faceTracking의 onFrameRef 즉시 동기화
    useEffect(() => {
        updateOnFrame(handleFrame)
    }, [handleFrame, updateOnFrame])

    // irisBaseline 리셋 트리거 구독
    // 페이지 이동 시 NavigationRuntime → gazeStore.triggerBaselineReset() → Worker RESET_BASELINE
    const sendCommandRef = useRef(sendCommand)
    useEffect(() => {
        sendCommandRef.current = sendCommand
    }, [sendCommand])

    useEffect(() => {
        return useGazeStore.subscribe(
            (state) => state.baselineResetTrigger,
            (trigger) => {
                if (trigger > 0) {
                    sendCommandRef.current({ type: 'RESET_BASELINE' })
                    console.log('[GazeRuntime] 🔄 RESET_BASELINE → Worker (trigger:', trigger, ')')
                }
            }
        )
    }, [])

    // 드웰(응시) 기준 시간 설정 → Worker 동기화
    // 1) 설정 페이지에서 값이 바뀔 때마다 즉시 전송
    // 2) Worker가 막 ready 된 시점에도 현재 값을 1회 전송 (초기화 동기화)
    useEffect(() => {
        return useGazeStore.subscribe(
            (state) => state.dwellThresholdMs,
            (ms) => {
                sendCommandRef.current({ type: 'SET_DWELL_THRESHOLD', ms })
                console.log('[GazeRuntime] ⏱ SET_DWELL_THRESHOLD → Worker:', ms, 'ms')
            }
        )
    }, [])

    useEffect(() => {
        if (isReady) {
            sendCommandRef.current({
                type: 'SET_DWELL_THRESHOLD',
                ms: useGazeStore.getState().dwellThresholdMs,
            })
        }
    }, [isReady])

    /*
     * lifecycle (safe from React StrictMode race conditions)
     */
    useEffect(() => {
        mountedRef.current = true
        let active = true
        let stream: MediaStream | null = null

        async function startRuntime() {
            try {
                setStatus('initializing')

                const video = videoRef.current
                if (!video) {
                    throw new Error('Video element not ready')
                }

                /*
                 * webcam stream
                 */
                const mediaStream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: 'user',
                        width: { ideal: 1920 },
                        height: { ideal: 1080 },
                    },
                    audio: false,
                })

                if (!active) {
                    mediaStream.getTracks().forEach((t) => t.stop())
                    return
                }

                stream = mediaStream
                streamRef.current = mediaStream
                video.srcObject = mediaStream

                /*
                 * wait metadata
                 */
                await new Promise<void>((resolve) => {
                    video.onloadedmetadata = () => resolve()
                })

                if (!active) return

                /**
                 * start video
                 */
                await video.play()

                await new Promise<void>((resolve) => {
                    const check = () => {
                        if (!active) return
                        if (video.videoWidth > 0 && video.videoHeight > 0) {
                            resolve()
                            return
                        }
                        requestAnimationFrame(check)
                    }
                    check()
                })

                if (!active) return

                console.log('[VideoReady]', video.videoWidth, video.videoHeight)
                setCameraReady(true)
                setCameraResolution(`${video.videoWidth}x${video.videoHeight}`)

                // ── PDF 로딩 완료까지 대기 (WASM 컴파일 경합 방지) ─────────────
                // MediaPipe WASM(~33MB) 컴파일은 V8 JIT 스레드 풀을 점유.
                // PDF.js getDocument() · page.render()와 동시 실행 시
                // 전체 로딩이 10초+ 로 늘어남.
                // isLoading=true(PDF 로딩 중)이면 WASM 초기화를 지연.
                // isLoading=false(PDF 렌더 완료) 되면 즉시 시작.
                if (useViewerStore.getState().isLoading) {
                    await new Promise<void>((resolve) => {
                        const unsub = useViewerStore.subscribe((state) => {
                            if (!state.isLoading) {
                                unsub()
                                resolve()
                            }
                        })
                    })
                    if (!active) return
                }

                /**
                 * start face tracking
                 */
                await start(video, handleFrame)

                if (!active) return

                setIsTracking(true)
                setStatus('running')
                console.log('[GazeRuntime] initialized')
            } catch (error) {
                console.error('[GazeRuntime] initialize failed', error)
                if (active) {
                    setStatus('error')
                    setIsTracking(false)
                }
            }
        }

        const id = requestAnimationFrame(() => {
            void startRuntime()
        })

        return () => {
            active = false
            mountedRef.current = false
            cancelAnimationFrame(id)

            console.log('[GazeRuntime] cleanup start')
            stop()
            void destroy()
            terminate()

            if (stream) {
                stream.getTracks().forEach((t) => t.stop())
            }

            streamRef.current = null
            setCameraReady(false)
            setIsTracking(false)
            console.log('[GazeRuntime] cleanup complete')
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // ── PDF 로딩 중 face tracking 일시정지 ──────────────────────────────────────
    // 문제: MediaPipe WASM face detection이 메인 스레드에서 10~50ms/frame (30fps rAF)
    //       PDF.js page.render()도 메인 스레드에서 실행
    //       → MediaPipe가 CPU 독점 → PDF.js가 ~20% 배분 → 2s 렌더가 10s+
    // 해법: isLoading=true 시 stop() → tracker.getStatus()='stopped'
    //       → rAF 루프는 유지되나 detect() 호출 없음 → PDF.js 메인 스레드 독점
    //       → isLoading=false 시 start(video) → status='running' 복원
    //       (이미 초기화된 상태이므로 start() 재호출은 빠름 — WASM 재다운로드 없음)
    const stopRef = useRef(stop)
    const startRef = useRef(start)
    const handleFrameRef = useRef(handleFrame)
    useEffect(() => { stopRef.current = stop }, [stop])
    useEffect(() => { startRef.current = start }, [start])
    useEffect(() => { handleFrameRef.current = handleFrame }, [handleFrame])

    useEffect(() => {
        let prevLoading = useViewerStore.getState().isLoading
        return useViewerStore.subscribe(
            (state) => {
                const loading = state.isLoading
                if (loading !== prevLoading) {
                    prevLoading = loading
                    if (loading) {
                        stopRef.current()
                        console.log('[GazeRuntime] PDF 로딩 중 face tracking 일시정지')
                    } else {
                        const video = videoRef.current
                        if (video && mountedRef.current) {
                            void startRef.current(video, handleFrameRef.current ?? undefined)
                            console.log('[GazeRuntime] face tracking 재개')
                        }
                    }
                }
            }
        )
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    return (
        <video
            ref={videoRef}
            className={`webcam-preview${config.enableCameraPreview ? '' : ' webcam-preview--off'}`}
            playsInline
            muted
        />
    )
}
