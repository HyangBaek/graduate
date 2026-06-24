// src/infrastructure/mediapipe/FaceMeshWorkerAdapter.ts
//
// FaceMeshAdapter의 워커 격리 버전.
// MediaPipe 추론(detectForVideo)을 src/workers/faceTracking.worker.ts에서 실행하여
// 메인 스레드 블로킹을 제거한다 (CLAUDE.md Performance 규칙).
//
// 외부 계약은 FaceTracker 인터페이스(동기 pull 방식 detect())를 그대로 유지한다.
// 내부적으로는 매 프레임 OffscreenCanvas로 캡처한 ImageBitmap을 워커로 전송하고,
// 워커가 비동기로 돌려준 최신 결과(latestResult)를 detect() 호출 시 즉시 반환한다.

import FaceTrackingWorker from '@/workers/faceTracking.worker?worker'

import type {
  FaceTrackingWorkerInbound,
  FaceTrackingWorkerOutbound,
} from '@/workers/types/faceTracking.types'

import type {
  FaceTracker,
  FaceTrackerConfig,
  FaceTrackerStatus,
  FaceTrackingCallback,
  FaceTrackingErrorCallback,
  FaceTrackingResult,
  LandmarkCallback,
} from '@/domain/interfaces/FaceTracker'

import type { FaceLandmark } from '@/domain/models/FaceLandmark'

import { LandmarkExtractor } from '@/infrastructure/mediapipe/LandmarkExtractor'

/**
 * Web Worker 안에서 MediaPipe 얼굴 추적을 실행하는 FaceTracker 구현체.
 * 메인 스레드는 OffscreenCanvas로 캡처한 프레임을 워커로 보내고, 워커가 비동기로
 * 반환한 최신 결과를 캐시해 동기 detect() 호출에 즉시 응답한다.
 */
export class FaceMeshWorkerAdapter implements FaceTracker {
  private worker: Worker | null = null

  private workerReady = false

  private initializePromise: Promise<void> | null = null

  private status: FaceTrackerStatus = 'idle'

  private config: FaceTrackerConfig

  private videoElement: HTMLVideoElement | null = null

  private captureCanvas: OffscreenCanvas | null = null

  private captureCtx: OffscreenCanvasRenderingContext2D | null = null

  private frameInFlight = false

  private latestResult: FaceTrackingResult | null = null

  private readonly landmarkExtractor = new LandmarkExtractor()

  private readonly trackingCallbacks = new Set<FaceTrackingCallback>()

  private readonly landmarkCallbacks = new Set<LandmarkCallback>()

  private readonly errorCallbacks = new Set<FaceTrackingErrorCallback>()

  constructor(config: FaceTrackerConfig = {}) {
    this.config = {
      targetFPS: 30,
      maxFaces: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
      debug: false,
      ...config,
    }
  }

  /**
   * 워커를 생성하고 MediaPipe 모델 초기화가 끝날 때까지 대기한다.
   * 이미 준비되었거나 초기화가 진행 중이면 중복 실행 없이 기존 Promise를 재사용한다.
   *
   * @returns 초기화 완료 시 resolve되는 Promise
   * @throws 워커 생성 실패 또는 워커 내부 모델 초기화 실패 시
   */
  async initialize(): Promise<void> {
    if (this.workerReady) {
      return
    }

    if (this.initializePromise) {
      return this.initializePromise
    }

    this.initializePromise = this.performInitialize()

    return this.initializePromise
  }

  /**
   * 실제 워커 생성/초기화 절차를 수행한다.
   * 워커의 INIT_ACK/INIT_ERROR 메시지로 초기화 성공 여부를 판단하고,
   * 워커 자체의 런타임 오류(onerror)도 초기화 단계에서는 실패로 처리한다.
   *
   * @returns 초기화 완료 Promise
   * @throws 워커 오류 또는 INIT_ERROR 수신 시
   */
  private async performInitialize(): Promise<void> {
    this.status = 'initializing'

    try {
      // 워커 생성과 INIT 메시지 전송 후, 워커가 INIT_ACK/INIT_ERROR로 응답할 때까지
      // Promise로 대기한다. onerror도 함께 감시해 워커 자체 크래시를 놓치지 않는다.
      await new Promise<void>((resolve, reject) => {
        this.worker = new FaceTrackingWorker()

        this.worker.onmessage = (
          event: MessageEvent<FaceTrackingWorkerOutbound>,
        ) => {
          const data = event.data

          if (data.type === 'INIT_ACK') {
            this.workerReady = true
            resolve()
            return
          }

          if (data.type === 'INIT_ERROR') {
            reject(new Error(data.message))
            return
          }

          this.handleWorkerMessage(data)
        }

        this.worker.onerror = (error: ErrorEvent) => {
          const err = new Error(error.message || 'faceTracking worker error')

          if (!this.workerReady) {
            reject(err)
            return
          }

          this.handleDetectionError(err)
        }

        const initMessage: FaceTrackingWorkerInbound = {
          type: 'INIT',
          config: {
            maxFaces: this.config.maxFaces,
            minDetectionConfidence: this.config.minDetectionConfidence,
            minTrackingConfidence: this.config.minTrackingConfidence,
          },
        }

        this.worker.postMessage(initMessage)
      })

      this.status = 'ready'
    } catch (error) {
      this.status = 'error'

      const initError =
        error instanceof Error
          ? error
          : new Error('Failed to initialize FaceMeshWorkerAdapter')

      console.error('[FaceMeshWorkerAdapter] initialize failed:', initError)
      this.emitError(initError)

      throw error
    } finally {
      this.initializePromise = null
    }
  }

  /**
   * 얼굴 추적을 시작한다. 워커가 준비되지 않았으면 먼저 초기화를 수행한다.
   *
   * @param video 프레임을 캡처할 대상 비디오 엘리먼트
   */
  async start(video: HTMLVideoElement): Promise<void> {
    if (this.status === 'running') {
      return
    }

    if (!this.workerReady) {
      await this.initialize()
    }

    this.videoElement = video

    this.status = 'running'
  }

  /*
   * single frame pull.
   *
   * 워커 결과는 비동기로 도착하므로, 여기서는 다음 프레임 캡처를
   * fire-and-forget으로 트리거하고 캐시된 최신 결과를 즉시 반환한다.
   */
  /**
   * 동기적으로 최신 추적 결과를 가져온다. FaceTracker 인터페이스 계약을 만족시키기
   * 위해, 내부적으로는 다음 프레임 캡처/전송을 비동기로 트리거(fire-and-forget)하고
   * 직전에 워커가 반환한 캐시된 결과를 즉시 돌려준다.
   *
   * @returns 캐시된 최신 FaceTrackingResult, 추적 불가 상태면 null
   */
  detect(): FaceTrackingResult | null {
    if (!this.canDetect()) {
      return null
    }

    this.captureAndSendFrame()

    return this.latestResult
  }

  /**
   * 현재 프레임 캡처/전송이 가능한 상태인지 확인한다
   * (실행 중 상태, 워커 준비 완료, 비디오 엘리먼트와 데이터 준비 여부).
   *
   * @returns 캡처 가능 여부
   */
  private canDetect(): boolean {
    if (this.status !== 'running') {
      return false
    }

    if (!this.worker || !this.workerReady) {
      return false
    }

    if (!this.videoElement) {
      return false
    }

    if (this.videoElement.readyState < 2) {
      return false
    }

    return true
  }

  /**
   * 비디오 엘리먼트의 현재 프레임을 OffscreenCanvas에 그려 ImageBitmap으로 변환한 뒤
   * 워커로 전송한다. 이미 전송한 프레임의 처리가 끝나지 않았으면(frameInFlight) 새
   * 프레임을 보내지 않아 워커 큐에 프레임이 쌓이는 것을 방지한다.
   */
  private captureAndSendFrame(): void {
    if (this.frameInFlight) {
      return
    }

    const video = this.videoElement!

    const width = video.videoWidth
    const height = video.videoHeight

    if (!width || !height) {
      return
    }

    if (!this.captureCanvas) {
      this.captureCanvas = new OffscreenCanvas(width, height)
      this.captureCtx = this.captureCanvas.getContext('2d')
    }

    if (
      this.captureCanvas.width !== width ||
      this.captureCanvas.height !== height
    ) {
      this.captureCanvas.width = width
      this.captureCanvas.height = height
    }

    if (!this.captureCtx) {
      return
    }

    try {
      this.captureCtx.drawImage(video, 0, 0, width, height)

      // transferToImageBitmap()으로 캔버스 내용을 zero-copy로 추출하고,
      // postMessage의 transfer 목록에 담아 메인 스레드↔워커 간 복사 비용 없이 넘긴다.
      const bitmap = this.captureCanvas.transferToImageBitmap()

      this.frameInFlight = true

      const message: FaceTrackingWorkerInbound = {
        type: 'FRAME',
        bitmap,
        timestamp: performance.now(),
      }

      this.worker!.postMessage(message, [bitmap])
    } catch (error) {
      // postMessage/drawImage 실패 시 frameInFlight가 true로 남으면 이후 모든
      // captureAndSendFrame 호출이 `if (this.frameInFlight) return`에 막혀
      // 영구적으로 새 프레임을 보내지 못하게 된다 — 추적이 조용히 완전 정지하는 버그.
      // 다음 틱에서 재시도할 수 있도록 반드시 리셋한다.
      this.frameInFlight = false

      this.handleDetectionError(
        error instanceof Error ? error : new Error('frame capture failed'),
      )
    }
  }

  /**
   * 워커가 보낸 메시지를 타입에 따라 분기 처리한다(추론 결과 / 추론 에러).
   *
   * @param data 워커가 보낸 outbound 메시지
   */
  private handleWorkerMessage(data: FaceTrackingWorkerOutbound): void {
    switch (data.type) {
      case 'RESULT':
        this.frameInFlight = false
        this.processResult(data.landmarks, data.timestamp)
        break

      case 'DETECT_ERROR':
        this.frameInFlight = false
        this.handleDetectionError(new Error(data.message))
        break

      default:
        break
    }
  }

  /**
   * 워커가 반환한 MediaPipe landmark 결과를 도메인 모델로 변환해 캐시하고 구독자에게 알린다.
   * landmarks가 null이면 얼굴 미검출로 간주해 빈 결과를 생성한다.
   *
   * @param landmarks 워커가 반환한 MediaPipe landmark 좌표 배열, 또는 미검출 시 null
   * @param timestamp 워커가 프레임을 처리한 시각(performance.now 기준)
   */
  private processResult(
    landmarks: { x: number; y: number; z: number }[] | null,
    timestamp: number,
  ): void {
    if (!landmarks) {
      const noFaceResult: FaceTrackingResult = {
        landmarks: [],
        isFaceDetected: false,
        confidence: 0,
        timestamp: Date.now(),
      }

      this.latestResult = noFaceResult
      this.emitTracking(noFaceResult)
      return
    }

    const landmark = this.landmarkExtractor.extract(landmarks, 1)

    const domainLandmarks: FaceLandmark[] = [landmark]

    const result: FaceTrackingResult = {
      landmarks: domainLandmarks,
      isFaceDetected: true,
      confidence: landmark.confidence,
      timestamp: landmark.timestamp ?? timestamp,
    }

    this.latestResult = result

    this.emitTracking(result)
    this.emitLandmarks(domainLandmarks)
  }

  /**
   * 프레임 단위 추적 오류를 처리한다. 이런 오류는 대부분 일시적(WASM 처리
   * 실패, 캡처 실패 등)이라 status를 'error'로 영구 고정하지 않는다 — 이전에는
   * 여기서 status='error'로 바꿔버려서, 단 한 번의 일시적 실패만으로 canDetect()가
   * 영원히 false가 되어 추적이 조용히(콘솔 로그도 없이) 완전 정지하는 버그가 있었음.
   * 다음 프레임에서 다시 시도할 수 있도록 status는 그대로 두고 로그만 남긴다.
   *
   * @param error 발생한 오류
   */
  private handleDetectionError(error: Error): void {
    console.error('[FaceMeshWorkerAdapter] detection error:', error)
    this.emitError(error)
  }

  /** 얼굴 추적을 중지한다(워커는 종료하지 않고 상태만 변경). */
  stop(): void {
    this.status = 'stopped'
  }

  /**
   * 워커를 종료하고 모든 내부 상태(캔버스, 콜백, 참조)를 초기화한다.
   * 리소스 누수를 막기 위해 워커에 STOP 메시지를 보낸 뒤 terminate()로 완전히 종료한다.
   */
  async destroy(): Promise<void> {
    this.stop()

    if (this.worker) {
      const stopMessage: FaceTrackingWorkerInbound = { type: 'STOP' }
      this.worker.postMessage(stopMessage)
      this.worker.terminate()
    }

    this.worker = null
    this.workerReady = false
    this.initializePromise = null

    this.videoElement = null
    this.captureCanvas = null
    this.captureCtx = null
    this.frameInFlight = false
    this.latestResult = null

    this.trackingCallbacks.clear()
    this.landmarkCallbacks.clear()
    this.errorCallbacks.clear()

    this.status = 'idle'
  }

  /** @returns 현재 추적기 상태 */
  getStatus(): FaceTrackerStatus {
    return this.status
  }

  /** @returns 현재 적용된 설정 */
  getConfig(): FaceTrackerConfig {
    return this.config
  }

  /**
   * 설정을 부분적으로 갱신한다. 워커에는 즉시 반영되지 않으며 다음 초기화 시 사용된다.
   *
   * @param config 덮어쓸 설정 값(부분)
   */
  updateConfig(config: Partial<FaceTrackerConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    }
  }

  /**
   * 추적 결과 콜백을 등록한다.
   *
   * @param callback 추적 결과를 받을 콜백
   * @returns 등록 해제 함수
   */
  onTracking(callback: FaceTrackingCallback): () => void {
    this.trackingCallbacks.add(callback)

    return () => {
      this.trackingCallbacks.delete(callback)
    }
  }

  /**
   * landmark 결과 콜백을 등록한다.
   *
   * @param callback landmark 배열을 받을 콜백
   * @returns 등록 해제 함수
   */
  onLandmarks(callback: LandmarkCallback): () => void {
    this.landmarkCallbacks.add(callback)

    return () => {
      this.landmarkCallbacks.delete(callback)
    }
  }

  /**
   * 에러 콜백을 등록한다.
   *
   * @param callback 에러를 받을 콜백
   * @returns 등록 해제 함수
   */
  onError(callback: FaceTrackingErrorCallback): () => void {
    this.errorCallbacks.add(callback)

    return () => {
      this.errorCallbacks.delete(callback)
    }
  }

  /** 등록된 모든 추적 콜백에 결과를 전달한다. */
  private emitTracking(result: FaceTrackingResult): void {
    this.trackingCallbacks.forEach((callback) => {
      callback(result)
    })
  }

  /** 등록된 모든 landmark 콜백에 결과를 전달한다. */
  private emitLandmarks(landmarks: FaceLandmark[]): void {
    this.landmarkCallbacks.forEach((callback) => {
      callback(landmarks)
    })
  }

  /** 등록된 모든 에러 콜백에 오류를 전달한다. */
  private emitError(error: Error): void {
    this.errorCallbacks.forEach((callback) => {
      callback(error)
    })
  }
}
