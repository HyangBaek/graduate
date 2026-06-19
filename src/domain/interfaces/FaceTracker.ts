// src/domain/interfaces/FaceTracker.ts

import type { FaceLandmark } from '@/domain/models/FaceLandmark'

/*
 * tracker 상태
 *
 * idle
 * 초기 상태
 *
 * initializing
 * model loading
 *
 * ready
 * initialize 완료
 *
 * running
 * tracking 중
 *
 * stopped
 * tracking 정지
 *
 * error
 * 오류 상태
 */
/**
 * FaceTracker의 동작 상태를 나타내는 타입.
 * idle(초기) → initializing(모델 로딩) → ready(초기화 완료) → running(추적 중) →
 * stopped(정지) 흐름을 가지며, 오류 발생 시 error로 전환된다.
 */
export type FaceTrackerStatus =
  | 'idle'
  | 'initializing'
  | 'ready'
  | 'running'
  | 'stopped'
  | 'error'

/*
 * FaceTracker 설정
 *
 * 역할:
 * tracker 동작 제어
 *
 * 주의:
 * gaze filtering 책임은 포함하지 않는다.
 */
/**
 * FaceTracker의 동작을 제어하는 설정값.
 * gaze filtering 등 시선 계산 책임은 포함하지 않으며, 순수하게 얼굴 추적 파이프라인
 * 동작(FPS, 신뢰도 임계값, 랜드마크 안정화 등)만을 다룬다.
 */
export interface FaceTrackerConfig {
  /*
   * tracking FPS 제한
   */
  targetFPS?: number

  /*
   * 최대 얼굴 수
   */
  maxFaces?: number

  /*
   * detection confidence threshold
   *
   * 얼굴 감지 최소 confidence
   */
  minDetectionConfidence?: number

  /*
   * tracking confidence threshold
   *
   * landmark tracking 최소 confidence
   */
  minTrackingConfidence?: number

  /*
   * landmark smoothing 여부
   *
   * 주의:
   * gaze smoothing 아님
   *
   * tracker level landmark stabilization 용도
   */
  enableSmoothing?: boolean

  /*
   * debug mode
   */
  debug?: boolean
}

/*
 * tracking 결과
 *
 * tracking pipeline 표준 payload
 */
/**
 * 한 프레임의 얼굴 추적 결과 (tracking pipeline 표준 payload).
 */
export interface FaceTrackingResult {
  /*
   * 검출된 얼굴 landmark
   */
  landmarks: FaceLandmark[]

  /*
   * 얼굴 검출 여부
   */
  isFaceDetected: boolean

  /*
   * tracking confidence 전체
   *
   * 0 ~ 1
   */
  confidence: number

  /*
   * timestamp
   */
  timestamp: number
}

/*
 * tracking callback
 *
 * Face tracking 이벤트 콜백
 *
 * 역할:
 * MediaPipe → Domain boundary event
 *
 * 반드시 FaceLandmark만 전달
 *
 * gaze 계산 금지
 * filtering 금지
 * calibration 금지
 */
/**
 * 얼굴 추적 이벤트 콜백 (MediaPipe 등 외부 구현체 → Domain 경계 이벤트).
 * 반드시 FaceLandmark 기반 결과만 전달해야 하며, gaze 계산/filtering/calibration
 * 책임을 가져서는 안 된다.
 * @param result 한 프레임의 추적 결과
 */
export type FaceTrackingCallback = (result: FaceTrackingResult) => void

/*
 * lightweight landmark callback
 */
/**
 * 경량 랜드마크 전용 콜백.
 * @param landmarks 검출된 얼굴 랜드마크 배열
 */
export type LandmarkCallback = (landmarks: FaceLandmark[]) => void

/*
 * error callback
 */
/**
 * 얼굴 추적 중 발생한 오류를 전달하는 콜백.
 * @param error 발생한 오류 객체
 */
export type FaceTrackingErrorCallback = (error: Error) => void

/*
 * FaceTracker Interface
 *
 * Domain boundary 핵심 원칙
 *
 * Domain은 MediaPipe를 몰라야 한다.
 * Domain은 TensorFlow를 몰라야 한다.
 * Domain은 브라우저 구현체를 몰라야 한다.
 *
 * 역할
 *
 * 얼굴 landmark tracking 전용 interface
 *
 * gaze 계산 책임 없음
 * filtering 책임 없음
 * calibration 책임 없음
 */
/**
 * 얼굴 랜드마크 추적 전용 인터페이스 (Domain boundary).
 * Domain 계층은 MediaPipe/TensorFlow/브라우저 구현체를 알지 못해야 하며, 이 인터페이스를
 * 통해서만 외부 추적 구현체와 통신한다. gaze 계산, filtering, calibration 책임은
 * 가지지 않는다.
 */
export interface FaceTracker {
  /*
   * tracker 초기화
   * initialize
   *
   * 역할:
   * model preload
   * wasm preload
   * internal resource initialize
   */
  /**
   * tracker를 초기화한다 (모델/wasm preload 및 내부 리소스 준비).
   * @returns 초기화 완료 시 resolve되는 Promise
   */
  initialize(): Promise<void>

  /*
   * tracking 시작
   */
  /**
   * 주어진 비디오 엘리먼트를 입력으로 얼굴 추적을 시작한다.
   * @param video 추적 대상 비디오 엘리먼트
   * @returns 추적 시작 완료 시 resolve되는 Promise
   */
  start(video: HTMLVideoElement): Promise<void>

  /*
   * tracking 중지
   */
  /**
   * 얼굴 추적을 중지한다.
   */
  stop(): void

  /*
   * destroy
   *
   * 리소스 해제 정리
   * 역할:
   * resource cleanup
   * event cleanup
   * worker cleanup
   */
  /**
   * tracker 리소스를 완전히 해제한다 (이벤트, worker, 내부 리소스 정리).
   * @returns 해제 완료 시 resolve되는 Promise
   */
  destroy(): Promise<void>

  /*
   * 현재 상태 반환
   */
  /**
   * 현재 tracker 상태를 반환한다.
   * @returns 현재 FaceTrackerStatus
   */
  getStatus(): FaceTrackerStatus

  /*
   * 현재 설정 반환
   */
  /**
   * 현재 설정을 반환한다.
   * @returns 현재 FaceTrackerConfig
   */
  getConfig(): FaceTrackerConfig

  /*
   * 설정 업데이트
   */
  /**
   * 설정을 부분적으로 업데이트한다.
   * @param config 변경할 설정 값(부분)
   */
  updateConfig(config: Partial<FaceTrackerConfig>): void

  /*
   * tracking event subscribe
   *
   * full tracking payload
   */
  /**
   * 전체 추적 결과(payload) 이벤트를 구독한다.
   * @param callback 추적 결과를 받을 콜백
   * @returns 구독 해제 함수
   */
  onTracking(callback: FaceTrackingCallback): () => void

  /*
   * landmark only subscribe
   *
   * lightweight subscriber 용도
   */
  /**
   * 랜드마크만 전달되는 경량 이벤트를 구독한다.
   * @param callback 랜드마크 배열을 받을 콜백
   * @returns 구독 해제 함수
   */
  onLandmarks(callback: LandmarkCallback): () => void

  /*
   * error event subscribe
   */
  /**
   * 오류 이벤트를 구독한다.
   * @param callback 오류를 받을 콜백
   * @returns 구독 해제 함수
   */
  onError(callback: FaceTrackingErrorCallback): () => void
}
