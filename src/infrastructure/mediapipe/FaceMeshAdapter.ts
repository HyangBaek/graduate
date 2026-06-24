// src/infrastructure/mediapipe/FaceMeshAdapter.ts

import {
  FaceLandmarker,
  FilesetResolver,
} from '@mediapipe/tasks-vision'

import type {
  FaceTracker,
  FaceTrackerConfig,
  FaceTrackerStatus,
  FaceTrackingCallback,
  FaceTrackingErrorCallback,
  FaceTrackingResult,
  LandmarkCallback,
} from '@/domain/interfaces/FaceTracker'

import type {
  FaceLandmark,
} from '@/domain/models/FaceLandmark'

import {
  LandmarkExtractor,
} from '@/infrastructure/mediapipe/LandmarkExtractor'

import {
  MEDIAPIPE_CONFIG,
} from '@/infrastructure/mediapipe/MediaPipeConfig'

export class FaceMeshAdapter
  implements FaceTracker
{
  /*
   * MediaPipe instance
   */
  private faceLandmarker:
    | FaceLandmarker
    | null = null

  /*
   * tracker status
   */
  private status: FaceTrackerStatus =
    'idle'

  /*
   * initialize dedupe
   */
  private initializePromise:
    | Promise<void>
    | null = null

  /*
   * 현재 config
   */
  private config: FaceTrackerConfig

  /*
   * active video source
   */
  private videoElement:
    | HTMLVideoElement
    | null = null

  /*
   * landmark extractor
   */
  private readonly landmarkExtractor =
    new LandmarkExtractor()

  /*
   * subscribers
   */
  private readonly trackingCallbacks =
    new Set<FaceTrackingCallback>()

  private readonly landmarkCallbacks =
    new Set<
      (
        landmarks: FaceLandmark[],
      ) => void
    >()

  private readonly errorCallbacks =
    new Set<
      FaceTrackingErrorCallback
    >()

  constructor(
    config: FaceTrackerConfig = {},
  ) {
    this.config = {
      targetFPS: 30,

      maxFaces: 1,

      minDetectionConfidence: 0.5,

      minTrackingConfidence: 0.5,

      debug: false,

      ...config,
    }
  }

  /*
   * initialize
   *
   * model preload
   * wasm preload
   */
  async initialize(): Promise<void> {
    /*
     * already initialized 이미 초기화 완료
     */
    if (this.faceLandmarker) {
      return
    }

    /*
     * prevent duplicate initialize
     */
    if (this.initializePromise) {
      return this.initializePromise
    }

    this.initializePromise =
      this.performInitialize()

    return this.initializePromise
  }

  /*
   * 실제 initialize 수행
   */
  private async performInitialize(): Promise<void> {
    try {
      this.status =
        'initializing'

      const vision =
        await FilesetResolver.forVisionTasks(
          MEDIAPIPE_CONFIG.visionBasePath,
        )

      this.faceLandmarker =
        await FaceLandmarker.createFromOptions(
          vision,
          {
            baseOptions: {
              modelAssetPath:
                MEDIAPIPE_CONFIG.modelAssetPath,
            },

            runningMode:
              MEDIAPIPE_CONFIG.runningMode,

            numFaces:
              this.config.maxFaces ?? 1,

            outputFaceBlendshapes:
              MEDIAPIPE_CONFIG.outputFaceBlendshapes,

            outputFacialTransformationMatrixes:
              MEDIAPIPE_CONFIG.outputFacialTransformationMatrixes,

            minFaceDetectionConfidence:
              this.config
                .minDetectionConfidence,

            minTrackingConfidence:
              this.config
                .minTrackingConfidence,
          },
        )

      /*
       * FaceTrackerStatus 타입 맞춤
       *
       * ready 사용 금지
       */
      this.status = 'ready'
    } catch (error) {
      this.status = 'error'

      this.emitError(
        error instanceof Error
          ? error
          : new Error(
              'Failed to initialize FaceMeshAdapter',
            ),
      )

      throw error
    } finally {
      this.initializePromise = null
    }
  }

  /*
   * tracking start 시작
   *
   * 실제 detect loop는
   * 외부 orchestration(useFrameLoop)이 담당
   */
  async start(
    video: HTMLVideoElement,
  ): Promise<void> {
    /*
     * prevent duplicate start
     */
    if (this.status === 'running') {
      return
    }

    /*
     * lazy initialize
     */
    if (!this.faceLandmarker) {
      await this.initialize()
    }

    this.videoElement = video

    this.status = 'running'
  }

  /*
   * single frame detect
   *
   * Adapter는 orchestration 책임 없음
   * orchestration only
  */
  detect():
    | FaceTrackingResult
    | null {

    if (!this.canDetect()) {
      return null
    }

    try {
      const detection =
        this.faceLandmarker!.detectForVideo(
          this.videoElement!,
          performance.now(),
        )

      return this.processDetection(detection,)
    } catch (error) {
      console.error('[Adapter] detect error', error,)
      this.handleDetectionError(error,)

      return null
    }
  }

  /*
   * detect availability 가능 여부
   */
  private canDetect(): boolean {
    if (
      this.status !== 'running'
    ) {
      return false
    }

    if (!this.faceLandmarker) {
      return false
    }

    if (!this.videoElement) {
      return false
    }

    /*
     * HTMLMediaElement readiness
     *
     * HAVE_CURRENT_DATA = 2
     */
    if (
      this.videoElement.readyState < 2
    ) {
      return false
    }

    return true
  }

  /*
   * MediaPipe result 처리
   */
  private processDetection(
    detection:
      | ReturnType<
          FaceLandmarker['detectForVideo']
        >
      | null,
  ): FaceTrackingResult | null {
    const rawLandmarks =
      detection?.faceLandmarks?.[0]

    /*
    * no face detected 얼굴 미검출
    */
    let noFaceResult: FaceTrackingResult
    if (!rawLandmarks) {
      noFaceResult = this.emitNoFace()
      this.emitTracking(
        noFaceResult,
      )

      return noFaceResult
    }

    /*
     * domain model 변환
     */
    const landmark =
      this.landmarkExtractor.extract(
        rawLandmarks,
        1,
      )

    const landmarks = [
      landmark,
    ]

    const result: FaceTrackingResult =
      {
        landmarks,

        isFaceDetected: true,

        confidence:
          landmark.confidence,

        timestamp:
          landmark.timestamp,
      }

    /*
     * full tracking emit
     */
    this.emitTracking(result)

    /*
     * lightweight landmark emit
     */
    this.emitLandmarks(
      landmarks,
    )
    return result
  }

  /*
   * no face state emit
   */
  private emitNoFace(): FaceTrackingResult {
    const result: FaceTrackingResult =
      {
        landmarks: [],

        isFaceDetected: false,

        confidence: 0,

        timestamp: Date.now(),
      }

    this.emitTracking(result)
    return result
  }

  /*
   * error handling
   */
  private handleDetectionError(
    error: unknown,
  ): void {
    this.status = 'error'

    this.emitError(
      error instanceof Error
        ? error
        : new Error(
            'Face tracking failed',
          ),
    )
  }

  /*
   * stop tracking
   */
  stop(): void {
    this.status = 'stopped'
  }

  /*
   * 리소스 해제
   */
  async destroy(): Promise<void> {
    this.stop()

    this.faceLandmarker?.close()

    this.faceLandmarker =
      null

    this.videoElement = null

    this.initializePromise = null

    this.trackingCallbacks.clear()

    this.landmarkCallbacks.clear()

    this.errorCallbacks.clear()

    this.status = 'idle'
  }

  /*
   * current status 현재 상태 반환
   */
  getStatus(): FaceTrackerStatus {
    return this.status
  }

  /*
   * config getter 현재 설정 반환
   */
  getConfig(): FaceTrackerConfig {
    return this.config
  }

  /*
   * config update 설정 업데이트
   */
  updateConfig(
    config: Partial<FaceTrackerConfig>,
  ): void {
    this.config = {
      ...this.config,
      ...config,
    }
  }

  /*
   * gaze subscribe 이벤트 구독
   */
  onTracking(
    callback: FaceTrackingCallback,
  ): () => void {
    this.trackingCallbacks.add(
      callback,
    )

    return () => {
      this.trackingCallbacks.delete(
        callback,
      )
    }
  }

  /*
   * landmark submit subscribe
   */
  onLandmarks(
    callback: LandmarkCallback,
  ): () => void {
    this.landmarkCallbacks.add(
      callback,
    )

    return () => {
      this.landmarkCallbacks.delete(
        callback,
      )
    }
  }

  /*
   * error subscribe 이벤트 구독
   */
  onError(
    callback: FaceTrackingErrorCallback,
  ): () => void {
    this.errorCallbacks.add(
      callback,
    )

    return () => {
      this.errorCallbacks.delete(
        callback,
      )
    }
  }

  /*
   * emit tracking
   */
  private emitTracking(
    result: FaceTrackingResult,
  ): void {
    this.trackingCallbacks.forEach(
      (callback) => {
        callback(result)
      },
    )
  }

  /*
   * emit landmarks
   */
  private emitLandmarks(
    landmarks: FaceLandmark[],
  ): void {
    this.landmarkCallbacks.forEach(
      (callback) => {
        callback(landmarks)
      },
    )
  }

  /*
   * emit error
   */
  private emitError(
    error: Error,
  ): void {
    this.errorCallbacks.forEach(
      (callback) => {
        callback(error)
      },
    )
  }
}
