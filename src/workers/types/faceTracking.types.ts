// src/workers/types/faceTracking.types.ts
// 얼굴 추적 워커(faceTracking.worker.ts) ↔ 메인 스레드 메시지 타입

/**
 * faceTracking.worker 초기화(INIT) 시 전달하는 설정값.
 * 모두 옵셔널이며 미지정 시 MEDIAPIPE_CONFIG의 기본값이 사용된다.
 */
export interface FaceTrackingWorkerConfig {
  maxFaces?: number
  minDetectionConfidence?: number
  minTrackingConfidence?: number
}

/*
 * MediaPipe NormalizedLandmark 최소 형태.
 * 워커 경계를 넘는 순수 데이터이므로 MediaPipe 타입을 직접 노출하지 않는다.
 */
export interface RawLandmarkPoint {
  x: number
  y: number
  z: number
}

/**
 * 메인 스레드 → faceTracking.worker로 보내는 메시지 유니온.
 * INIT(모델 초기화) → FRAME(프레임별 검출 요청, 반복) → STOP(종료) 순서로 사용된다.
 */
export type FaceTrackingWorkerInbound =
  | { type: 'INIT'; config: FaceTrackingWorkerConfig }
  | { type: 'FRAME'; bitmap: ImageBitmap; timestamp: number }
  | { type: 'STOP' }

/**
 * faceTracking.worker → 메인 스레드로 보내는 응답 메시지 유니온.
 * INIT_ACK/INIT_ERROR는 INIT에 대한 응답, RESULT/DETECT_ERROR는 FRAME에 대한 응답이다.
 */
export type FaceTrackingWorkerOutbound =
  | { type: 'INIT_ACK' }
  | { type: 'INIT_ERROR'; message: string }
  | { type: 'RESULT'; landmarks: RawLandmarkPoint[] | null; timestamp: number }
  | { type: 'DETECT_ERROR'; message: string }
