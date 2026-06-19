// src/workers/faceTracking.worker.ts
// MediaPipe FaceLandmarker 추론 전용 워커
// 메인 스레드 블로킹 방지 — CLAUDE.md Performance 규칙 준수

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

import { MEDIAPIPE_CONFIG } from '../infrastructure/mediapipe/MediaPipeConfig'

import type {
  FaceTrackingWorkerConfig,
  FaceTrackingWorkerInbound,
  FaceTrackingWorkerOutbound,
  RawLandmarkPoint,
} from './types/faceTracking.types'

let faceLandmarker: FaceLandmarker | null = null

/**
 * 메인 스레드로 워커 결과 메시지를 전송하는 헬퍼.
 * @param message 전송할 outbound 메시지 (INIT_ACK/INIT_ERROR/RESULT/DETECT_ERROR)
 */
function postOut(message: FaceTrackingWorkerOutbound): void {
  self.postMessage(message)
}

/**
 * MediaPipe FaceLandmarker 모델을 비동기로 로드하고 초기화한다.
 * 성공 시 INIT_ACK, 실패 시 INIT_ERROR 메시지를 메인 스레드로 보낸다.
 *
 * @param config maxFaces/감지·추적 신뢰도 등 초기화 옵션
 */
async function initialize(config: FaceTrackingWorkerConfig): Promise<void> {
  try {
    // Vite dev/module worker 환경에서 dynamic import 시 global scope에 ModuleFactory가 바인딩되지 않는
    // 에러를 해결하기 위해, self.ModuleFactory가 없으면 vision_wasm_internal.js를 명시적으로
    // fetch한 뒤 Function 생성자로 실행하여 self.ModuleFactory를 할당한다.
    // @ts-ignore
    if (!self.ModuleFactory) {
      const loaderUrl = `${MEDIAPIPE_CONFIG.visionBasePath}/vision_wasm_internal.js`
      const response = await fetch(loaderUrl)
      if (!response.ok) {
        throw new Error(`Failed to fetch wasm loader from ${loaderUrl}: status ${response.status}`)
      }
      const code = await response.text()
      // self를 인자로 넘겨 scope 내에서 self.ModuleFactory = ModuleFactory 가 실행되도록 한다.
      const runLoader = new Function('self', `${code}\nself.ModuleFactory = ModuleFactory;`)
      runLoader(self)
      console.log('[Worker] ModuleFactory loaded successfully via manual patch.')
    }

    const vision = await FilesetResolver.forVisionTasks(
      MEDIAPIPE_CONFIG.visionBasePath,
    )

    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MEDIAPIPE_CONFIG.modelAssetPath,
      },
      runningMode: MEDIAPIPE_CONFIG.runningMode,
      numFaces: config.maxFaces ?? MEDIAPIPE_CONFIG.numFaces,
      outputFaceBlendshapes: MEDIAPIPE_CONFIG.outputFaceBlendshapes,
      outputFacialTransformationMatrixes:
        MEDIAPIPE_CONFIG.outputFacialTransformationMatrixes,
      minFaceDetectionConfidence: config.minDetectionConfidence,
      minFacePresenceConfidence: config.minTrackingConfidence,
      minTrackingConfidence: config.minTrackingConfidence,
    })

    postOut({ type: 'INIT_ACK' })
  } catch (error) {
    postOut({
      type: 'INIT_ERROR',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * 단일 비디오 프레임(ImageBitmap)에 대해 얼굴 랜드마크 검출을 수행하고
 * 결과를 RESULT 메시지로 메인 스레드에 전송한다.
 * 처리 성공/실패와 무관하게 항상 bitmap.close()로 메모리를 해제한다.
 *
 * @param bitmap 검출 대상 프레임 (transferable, 처리 후 close됨)
 * @param timestamp 해당 프레임의 타임스탬프 (ms)
 */
function detectFrame(bitmap: ImageBitmap, timestamp: number): void {
  try {
    if (!faceLandmarker) {
      throw new Error('faceLandmarker not initialized')
    }

    const detection = faceLandmarker.detectForVideo(bitmap, timestamp)

    const raw = detection.faceLandmarks[0]

    const landmarks: RawLandmarkPoint[] | null = raw
      ? raw.map((point) => ({ x: point.x, y: point.y, z: point.z }))
      : null

    postOut({ type: 'RESULT', landmarks, timestamp })
  } catch (error) {
    postOut({
      type: 'DETECT_ERROR',
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    bitmap.close()
  }
}

/*
 * 워커 메시지 프로토콜 (메인 스레드 → 워커):
 *   INIT  : FaceLandmarker 모델 초기화 요청 → 비동기 initialize() 실행, 완료 시 INIT_ACK/INIT_ERROR 응답
 *   FRAME : 비디오 프레임(ImageBitmap) 1장에 대한 동기 검출 요청 → RESULT/DETECT_ERROR 응답
 *   STOP  : 모델 종료 및 리소스 해제, 이후 FRAME 요청은 처리 불가
 */
self.onmessage = (event: MessageEvent<FaceTrackingWorkerInbound>) => {
  const data = event.data

  switch (data.type) {
    case 'INIT':
      void initialize(data.config)
      break

    case 'FRAME':
      detectFrame(data.bitmap, data.timestamp)
      break

    case 'STOP':
      faceLandmarker?.close()
      faceLandmarker = null
      break
  }
}

export {}
